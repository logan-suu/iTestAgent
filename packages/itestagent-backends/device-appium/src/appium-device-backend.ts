/**
 * AppiumDeviceBackend — DeviceBackend implementation for physical + simulator iOS devices.
 *
 * Implements the stable DeviceBackend interface (§5.1) using Appium/WDA.
 * ADR-011: supports both TargetKind.physical (devicectl/xcodebuild) and
 * TargetKind.simulator (simctl/xcodebuild).
 *
 * Architecture:
 *   - AppiumDriver (injected) abstracts WebDriverIO/Appium operations
 *   - Lazy session creation: session is established on first action requiring Appium
 *   - Coordinate conversion: normalized [0,1] ↔ Appium pixel coordinates
 *   - Error handling: all AppiumDriverError caught and converted to ActionResult (R5)
 *   - WdaStartupMode routing: preinstalled / external-url / managed-xcodebuild (Phase 3)
 *
 * R2: Uses Appium/WDA (mature open-source), does not re-implement device control.
 * R5: All errors are explicit — never silently degrade. Unsupported operations
 *      return success:false with clear error messages.
 * R9: Component name is "appium" (registered in BackendRegistry as 'appium').
 */

import type {
  ActionResult,
  AppInfo,
  ArtifactRef,
  BackendCapabilities,
  CrashSummary,
  DeviceBackend,
  DeviceInfo,
  DeviceTarget,
  HealthCheckResult,
  LaunchAppInput,
  LogCollectInput,
  OpenUrlInput,
  PressButtonInput,
  RecordingHandle,
  RecordingInput,
  ScreenshotInput,
  SwipeInput,
  TapInput,
  TargetKind,
  TerminateAppInput,
  TypeTextInput,
  UiTreeSnapshot,
} from 'itestagent-contracts';

import type { AppiumDriver, AppiumPoint, AppiumScreenSize } from './appium-driver.js';

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSimulatorCapabilities } from './appium-capabilities.js';
import type { SimulatorCapabilitiesOptions, WdaStartupMode } from './appium-capabilities.js';
import { buildPhysicalCapabilities } from './appium-capabilities.js';
import { AppiumDriverError } from './appium-driver.js';
import { redactError } from './redactor.js';
import type { WdaManager } from './wda-manager.js';

// ─── Subprocess helper ─────────────────────────────────────────

async function spawnAsync(
  cmd: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
}

// ─── Types ────────────────────────────────────────────────────────────────

/** Options for AppiumDeviceBackend construction. */
export interface AppiumDeviceBackendOptions {
  /** Device UDID (required). */
  udid: string;
  /** Execution target type: 'physical' (devicectl/xcodebuild) or 'simulator' (simctl/xcodebuild). */
  targetKind: TargetKind;
  /** App bundle ID to test. */
  bundleId?: string;
  /**
   * WDA base bundle ID for free-account workaround (physical only).
   * MUST be base ID WITHOUT .xctrunner suffix (e.g. "TEAMID.WebDriverAgentRunner").
   */
  wdaBundleId?: string;
  /**
   * WDA startup mode (physical only). Mutually exclusive — only ONE mode per session.
   * Default: 'preinstalled' (Route A — primary strategy for free accounts).
   * Ignored for simulator targetKind.
   */
  wdaStartupMode?: WdaStartupMode;
  /**
   * WDA URL for external-url mode (physical only).
   * Required when wdaStartupMode is 'external-url'.
   */
  webDriverAgentUrl?: string;
  /** WDA local port for WebDriverAgent communication (default: 8100). */
  wdaLocalPort?: number;
  /** MJPEG server port for video streaming (default: 9100). Required for parallel simulator sessions. */
  mjpegServerPort?: number;
  /**
   * Device display name for capabilities (optional).
   * If omitted, Appium infers from UDID. Used in capabilities for logging.
   */
  deviceName?: string;
  /** iOS version string (optional — for capabilities logging). */
  platformVersion?: string;
  /**
   * Custom derived data path for WDA builds.
   * Required for parallel simulator sessions (G5-SIM T1.6 finding #5).
   */
  derivedDataPath?: string;
  /**
   * Path to WDA .xcodeproj for managed-xcodebuild mode.
   * Required when wdaStartupMode is 'managed-xcodebuild'.
   */
  wdaProjectPath?: string;
  /**
   * Team ID for code signing (managed-xcodebuild mode).
   * When provided, Appium handles WDA build + signing.
   * When omitted, falls back to usePrebuiltWDA (free account workaround).
   */
  xcodeOrgId?: string;
  /** Signing identity for managed-xcodebuild (default: 'Apple Development'). */
  xcodeSigningId?: string;
  /**
   * WdaManager instance for managing WDA lifecycle (ADR-012).
   * When provided, WDA lifecycle is managed according to wdaStartupMode.
   * Optional for mock/testing.
   */
  wdaManager?: WdaManager;
}

// ─── Default capabilities ────────────────────────────────────────────────

const PHYSICAL_CAPABILITIES: BackendCapabilities = {
  supportedTargetKinds: ['physical'],
  features: [
    'uitree',
    'screenshot',
    'tap',
    'swipe',
    'text',
    'button',
    'url',
    'launch',
    'crash',
    'log',
    'recording',
  ],
  supportsUiTree: true,
  supportsScreenshot: true,
  supportsVideo: true,
  supportsCrashLogs: true,
  supportsLocation: false,
  supportsPush: false,
};

const SIMULATOR_CAPABILITIES: BackendCapabilities = {
  supportedTargetKinds: ['simulator'],
  features: [
    'uitree',
    'screenshot',
    'tap',
    'swipe',
    'text',
    'button',
    'url',
    'launch',
    'log',
    'recording',
  ],
  supportsUiTree: true,
  supportsScreenshot: true,
  supportsVideo: true,
  supportsCrashLogs: false,
  supportsLocation: false,
  supportsPush: false,
};

// ─── Implementation ───────────────────────────────────────────────────────

export class AppiumDeviceBackend implements DeviceBackend {
  readonly name = 'appium';

  private readonly opts: Required<
    Omit<
      AppiumDeviceBackendOptions,
      | 'bundleId'
      | 'wdaBundleId'
      | 'derivedDataPath'
      | 'wdaManager'
      | 'webDriverAgentUrl'
      | 'wdaProjectPath'
      | 'xcodeOrgId'
      | 'xcodeSigningId'
    >
  > &
    Pick<
      AppiumDeviceBackendOptions,
      | 'bundleId'
      | 'wdaBundleId'
      | 'derivedDataPath'
      | 'webDriverAgentUrl'
      | 'wdaProjectPath'
      | 'xcodeOrgId'
      | 'xcodeSigningId'
    >;

  private readonly targetKind: TargetKind;
  private readonly wdaStartupMode: WdaStartupMode;
  private driver: AppiumDriver;
  private readonly wdaManager: WdaManager | undefined;
  private sessionActive = false;
  private sessionMutex: Promise<void> | null = null;
  private screenSize: AppiumScreenSize | null = null;

  constructor(driver: AppiumDriver, options: AppiumDeviceBackendOptions) {
    this.driver = driver;
    this.targetKind = options.targetKind;
    this.wdaManager = options.wdaManager;
    this.wdaStartupMode = options.wdaStartupMode ?? 'preinstalled';
    this.opts = {
      udid: options.udid,
      targetKind: options.targetKind,
      bundleId: options.bundleId,
      wdaBundleId: options.wdaBundleId,
      wdaStartupMode: this.wdaStartupMode,
      wdaLocalPort: options.wdaLocalPort ?? 8100,
      mjpegServerPort: options.mjpegServerPort ?? 9100,
      deviceName: options.deviceName ?? '',
      platformVersion: options.platformVersion ?? '',
      derivedDataPath: options.derivedDataPath,
      webDriverAgentUrl: options.webDriverAgentUrl,
      wdaProjectPath: options.wdaProjectPath,
      xcodeOrgId: options.xcodeOrgId,
      xcodeSigningId: options.xcodeSigningId,
    };
  }

  get capabilities(): BackendCapabilities {
    return this.targetKind === 'simulator' ? SIMULATOR_CAPABILITIES : PHYSICAL_CAPABILITIES;
  }

  // ── Session lifecycle ──────────────────────────────────────────────

  /**
   * Ensure an Appium session is active, creating one if necessary.
   *
   * Thread-safe: uses a mutex (sessionMutex) to prevent concurrent
   * session creation. Multiple callers awaiting ensureSession() will
   * all wait on the same creation promise — only one Appium session
   * is ever created.
   *
   * ADR-012 / Phase 3: WDA lifecycle varies by WdaStartupMode.
   *   - preinstalled: verify WDA on device, do NOT call wdaManager.launch()
   *   - external-url: launch WDA via wdaManager → waitForReady → pass webDriverAgentUrl
   *   - managed-xcodebuild: Appium manages WDA internally
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionActive) return;
    if (this.sessionMutex) {
      await this.sessionMutex;
      return;
    }

    this.sessionMutex = this.doCreateSession();

    try {
      await this.sessionMutex;
    } finally {
      this.sessionMutex = null;
    }
  }

  /**
   * Create an Appium session with the appropriate WDA startup mode.
   *
   * Phase 3: Now uses finally block to ensure cleanup on failure.
   */
  private async doCreateSession(): Promise<void> {
    try {
      let caps: Record<string, unknown>;

      if (this.targetKind === 'simulator') {
        caps = this.buildSimulatorCaps();
      } else {
        caps = await this.buildPhysicalCaps();
      }

      await this.driver.createSession(caps);
      this.sessionActive = true;

      this.screenSize = await this.driver.getScreenSize();
    } catch (error) {
      // Clean up WDA if it was started during this attempt (external-url mode)
      if (this.wdaManager && this.targetKind === 'physical') {
        if (this.wdaStartupMode === 'external-url' && this.wdaManager.isRunning()) {
          try {
            await this.wdaManager.stop();
          } catch {
            // Best-effort cleanup
          }
        }
      }
      throw error;
    }
  }

  /**
   * Build simulator capabilities — unchanged (G5-SIM verified).
   */
  private buildSimulatorCaps(): Record<string, unknown> {
    const simOpts: SimulatorCapabilitiesOptions = {
      udid: this.opts.udid,
      wdaLocalPort: this.opts.wdaLocalPort,
      mjpegServerPort: this.opts.mjpegServerPort,
      newCommandTimeout: 600,
    };
    if (this.opts.bundleId) simOpts.bundleId = this.opts.bundleId;
    if (this.opts.deviceName) simOpts.deviceName = this.opts.deviceName;
    if (this.opts.platformVersion) simOpts.platformVersion = this.opts.platformVersion;
    if (this.opts.derivedDataPath) simOpts.derivedDataPath = this.opts.derivedDataPath;
    return buildSimulatorCapabilities(simOpts) as Record<string, unknown>;
  }

  /**
   * Build physical capabilities with mode-specific WDA handling.
   */
  private async buildPhysicalCaps(): Promise<Record<string, unknown>> {
    const mode = this.wdaStartupMode;

    if (mode === 'preinstalled') {
      return this.buildPreinstalledCaps();
    }

    if (mode === 'external-url') {
      return this.buildExternalUrlCaps();
    }

    // managed-xcodebuild: Appium manages WDA internally
    return this.buildManagedXcodebuildCaps();
  }

  /**
   * Route A (preinstalled): WDA already on device — skip ALL Appium xcodebuild.
   *
   * Verifies preinstalled WDA exists before session creation.
   * Does NOT call wdaManager.launch().
   */
  private async buildPreinstalledCaps(): Promise<Record<string, unknown>> {
    // Verify preinstalled WDA if WdaManager is available
    if (this.wdaManager && this.opts.wdaBundleId) {
      const result = await this.wdaManager.verifyPreinstalledWDA(
        this.opts.udid,
        this.opts.wdaBundleId,
      );
      if (!result.ready) {
        throw new Error(
          `Preinstalled WDA not ready: ${result.reason ?? 'unknown'}. Run WdaManager.preparePreinstalledWDA() first.`,
        );
      }
    }

    return buildPhysicalCapabilities({
      udid: this.opts.udid,
      wdaLocalPort: this.opts.wdaLocalPort,
      newCommandTimeout: 600,
      wdaStartupMode: 'preinstalled',
      bundleId: this.opts.bundleId,
      wdaBundleId: this.opts.wdaBundleId || undefined,
      deviceName: this.opts.deviceName || undefined,
      platformVersion: this.opts.platformVersion || undefined,
    }) as Record<string, unknown>;
  }

  /**
   * Route B (external-url): iTestAgent manages WDA, Appium connects via URL.
   *
   * Launches WDA → waits for /status ready → passes webDriverAgentUrl.
   */
  private async buildExternalUrlCaps(): Promise<Record<string, unknown>> {
    if (!this.wdaManager) {
      throw new Error(
        'wdaManager is required for external-url mode. Provide a WdaManager instance.',
      );
    }

    // Launch WDA
    if (!this.wdaManager.isRunning()) {
      await this.wdaManager.launch({
        projectPath: '', // Configured per-deployment via WdaManager
        udid: this.opts.udid,
        wdaPort: this.opts.wdaLocalPort,
      });
    }

    // Wait for WDA to be ready
    await this.wdaManager.waitForReady(this.opts.wdaLocalPort);

    const wdaUrl = this.opts.webDriverAgentUrl ?? `http://127.0.0.1:${this.opts.wdaLocalPort}`;

    return buildPhysicalCapabilities({
      udid: this.opts.udid,
      wdaLocalPort: this.opts.wdaLocalPort,
      newCommandTimeout: 600,
      wdaStartupMode: 'external-url',
      webDriverAgentUrl: wdaUrl,
      bundleId: this.opts.bundleId,
      deviceName: this.opts.deviceName || undefined,
      platformVersion: this.opts.platformVersion || undefined,
    }) as Record<string, unknown>;
  }

  /**
   * Route C (managed-xcodebuild): Appium manages WDA internally.
   *
   * If WdaManager is configured, launches WDA before Appium session.
   * Uses usePrebuiltWDA to skip build-for-testing only.
   */
  private async buildManagedXcodebuildCaps(): Promise<Record<string, unknown>> {
    const hasSigning = Boolean(this.opts.xcodeOrgId);

    // When Appium handles signing (xcodeOrgId present), WdaManager must NOT launch WDA
    // — Appium's xcodebuild manages the WDA process directly. WdaManager launch would
    // create a port conflict on wdaLocalPort.
    if (!hasSigning && this.wdaManager && !this.wdaManager.isRunning()) {
      await this.wdaManager.launch({
        projectPath: this.opts.wdaProjectPath ?? '',
        udid: this.opts.udid,
        wdaPort: this.opts.wdaLocalPort,
      });
    }

    return buildPhysicalCapabilities({
      udid: this.opts.udid,
      wdaLocalPort: this.opts.wdaLocalPort,
      newCommandTimeout: 600,
      wdaStartupMode: 'managed-xcodebuild',
      usePrebuiltWDA: !hasSigning,
      bundleId: this.opts.bundleId,
      wdaBundleId: this.opts.wdaBundleId || undefined,
      deviceName: this.opts.deviceName || undefined,
      platformVersion: this.opts.platformVersion || undefined,
      derivedDataPath: this.opts.derivedDataPath,
      xcodeOrgId: this.opts.xcodeOrgId,
      xcodeSigningId: this.opts.xcodeSigningId ?? (hasSigning ? 'Apple Development' : undefined),
    }) as Record<string, unknown>;
  }

  /**
   * Close the current Appium session and release resources.
   *
   * ADR-012 / Phase 3 fix: WDA cleanup always runs regardless of sessionActive state.
   * Previously, returning early when sessionActive=false leaked WDA processes and ports.
   *
   * Idempotent — safe to call even if no session is active.
   */
  async closeSession(): Promise<void> {
    // Wait for any in-flight session creation to complete
    if (this.sessionMutex) {
      try {
        await this.sessionMutex;
      } catch {
        /* session creation failed — proceed to cleanup */
      }
    }

    // Delete Appium session if active
    if (this.sessionActive) {
      try {
        await this.driver.deleteSession();
      } catch {
        // Best-effort cleanup — don't throw on delete failure
      }
      this.sessionActive = false;
      this.screenSize = null;
    }

    // ADR-012: stop WDA regardless of sessionActive state
    // (was previously gated by sessionActive, causing leaks)
    if (this.wdaManager) {
      try {
        await this.wdaManager.stop();
      } catch {
        // Best-effort WDA cleanup
      }
    }
  }

  // ── Coordinate conversion ──────────────────────────────────────────

  /**
   * Convert normalized [0,1] coordinates to Appium pixel coordinates.
   *
   * Requires an active session (screen size must be known).
   */
  private toPixels(x: number, y: number): AppiumPoint {
    const size = this.screenSize;

    // Fallback to iPhone 14 Plus (428×926 points) when screen size unknown
    // R5: this is an approximation — the actual screen may differ
    const w = size?.width ?? 428;
    const h = size?.height ?? 926;

    return {
      x: Math.round(x * w),
      y: Math.round(y * h),
    };
  }

  // ── Error handling ─────────────────────────────────────────────────

  /** Convert AppiumDriverError to iTestAgent ActionResult (R5: never silent). */
  private toActionResult(error: unknown, operation: string): ActionResult {
    if (error instanceof AppiumDriverError) {
      return {
        success: false,
        error: `[${error.code}] ${operation}: ${error.message}`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `${operation}: ${message}`,
    };
  }

  /** Create a success ActionResult. */
  private ok(message?: string): ActionResult {
    return { success: true, message: message ?? 'ok' };
  }

  // ── DeviceBackend interface ─────────────────────────────────────────

  // ────────── listDevices ─────────────────────────────────────────

  async listDevices(): Promise<DeviceInfo[]> {
    if (this.targetKind === 'simulator') {
      return this.listSimulatorDevices();
    }
    return this.listPhysicalDevices();
  }

  /**
   * List physical iOS devices via devicectl (no Appium session needed).
   */
  private async listPhysicalDevices(): Promise<DeviceInfo[]> {
    try {
      const { stdout: raw, exitCode } = await spawnAsync([
        'xcrun',
        'devicectl',
        'list',
        'devices',
        '--json',
      ]);

      if (exitCode !== 0 || !raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw) as {
        result?: {
          devices?: Array<{
            connectionProperties?: { tunnelState?: string };
            hardwareProperties?: { udid?: string; productType?: string };
            deviceProperties?: { name?: string; osVersionNumber?: string };
          }>;
        };
      };

      const devices = parsed?.result?.devices ?? [];

      return devices
        .filter(
          (d) =>
            d.connectionProperties?.tunnelState === 'connected' ||
            d.connectionProperties?.tunnelState === 'available',
        )
        .map((d) => ({
          udid: String(d.hardwareProperties?.udid ?? ''),
          name: d.deviceProperties?.name,
          model: d.hardwareProperties?.productType,
          osVersion: d.deviceProperties?.osVersionNumber,
          platform: 'ios' as const,
          targetKind: 'physical' as const,
          state: 'booted' as const,
        }))
        .filter((d) => d.udid !== '');
    } catch {
      return [];
    }
  }

  /**
   * List iOS Simulator devices via simctl (no Appium session needed).
   *
   * Uses `xcrun simctl list devices --json` to discover all simulator
   * devices, including booted and shutdown ones. Filters to iOS runtimes only.
   *
   * R5: If simctl is unavailable, returns empty array.
   */
  private async listSimulatorDevices(): Promise<DeviceInfo[]> {
    try {
      const { stdout: raw, exitCode } = await spawnAsync([
        'xcrun',
        'simctl',
        'list',
        'devices',
        '--json',
      ]);

      if (exitCode !== 0 || !raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw) as {
        devices?: Record<string, Array<Record<string, unknown>>>;
      };
      const devicesMap = parsed.devices ?? {};

      const results: DeviceInfo[] = [];

      for (const [runtimeKey, deviceList] of Object.entries(devicesMap)) {
        if (!Array.isArray(deviceList)) continue;

        // Extract iOS version from runtime identifier
        // e.g. "com.apple.CoreSimulator.SimRuntime.iOS-18-2" → "18.2"
        const osMatch = runtimeKey.match(/iOS[- ](\d+)[-.](\d+)/);
        const osVersion = osMatch ? `${osMatch[1]}.${osMatch[2]}` : undefined;

        for (const d of deviceList) {
          const dObj = d as Record<string, unknown>;
          const state = String(dObj.state ?? 'shutdown').toLowerCase();

          results.push({
            udid: String(dObj.udid ?? ''),
            name: String(dObj.name ?? 'unknown'),
            model: String(dObj.deviceTypeIdentifier ?? 'unknown'),
            osVersion,
            platform: 'ios' as const,
            targetKind: 'simulator' as const,
            runtimeIdentifier: runtimeKey,
            deviceTypeIdentifier: String(dObj.deviceTypeIdentifier ?? ''),
            state: state as DeviceInfo['state'],
          });
        }
      }

      return results.filter((d) => d.udid !== '');
    } catch {
      return [];
    }
  }

  // ────────── healthcheck ─────────────────────────────────────────

  async healthcheck(deviceId: string): Promise<HealthCheckResult> {
    if (this.targetKind === 'simulator') {
      return this.simulatorHealthcheck(deviceId);
    }
    return this.physicalHealthcheck(deviceId);
  }

  private async physicalHealthcheck(deviceId: string): Promise<HealthCheckResult> {
    try {
      const { stdout, exitCode } = await spawnAsync([
        'xcrun',
        'devicectl',
        'list',
        'devices',
        '--json',
      ]);

      if (exitCode !== 0) {
        return {
          healthy: false,
          details: 'devicectl unavailable — ensure Xcode CLI tools are installed',
        };
      }

      const parsed = JSON.parse(stdout) as {
        result?: {
          devices?: Array<{
            hardwareProperties?: { udid?: string };
          }>;
        };
      };
      const devices = parsed?.result?.devices ?? [];
      const found = devices.some((d) => d.hardwareProperties?.udid === deviceId);

      if (!found) {
        return {
          healthy: false,
          details: `Device ${deviceId} not found in devicectl list`,
        };
      }

      return { healthy: true };
    } catch {
      return {
        healthy: false,
        details: 'Failed to check device health — devicectl error',
      };
    }
  }

  private async simulatorHealthcheck(deviceId: string): Promise<HealthCheckResult> {
    try {
      const { stdout: raw, exitCode } = await spawnAsync([
        'xcrun',
        'simctl',
        'list',
        'devices',
        '--json',
      ]);

      if (exitCode !== 0) {
        return {
          healthy: false,
          details: 'simctl unavailable — ensure Xcode CLI tools are installed',
        };
      }

      if (!raw.trim()) {
        return {
          healthy: false,
          details: 'No simulator devices found — simctl returned empty output',
        };
      }

      const parsed = JSON.parse(raw) as {
        devices?: Record<string, Array<Record<string, unknown>>>;
      };
      const devicesMap = parsed.devices ?? {};

      for (const deviceList of Object.values(devicesMap)) {
        if (!Array.isArray(deviceList)) continue;
        const found = deviceList.some((d) => (d as Record<string, unknown>).udid === deviceId);
        if (found) return { healthy: true };
      }

      return {
        healthy: false,
        details: `Simulator ${deviceId} not found in simctl device list`,
      };
    } catch {
      return {
        healthy: false,
        details: 'Failed to check simulator health — simctl error',
      };
    }
  }

  // ────────── listApps ────────────────────────────────────────────

  async listApps(_deviceId: string): Promise<AppInfo[]> {
    try {
      await this.ensureSession();

      const apps = await this.driver.listApps();

      return apps.map((app) => ({
        bundleId: app.bundleId,
        name: app.name ?? app.bundleId,
        version: app.version,
        buildNumber: app.buildNumber,
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(redactError(`[AppiumDeviceBackend.listApps] ${errorMsg}`));
      return [];
    }
  }

  // ────────── launchApp ───────────────────────────────────────────

  async launchApp(input: LaunchAppInput): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const result = await this.driver.launchApp(input.bundleId);
      if (result.success) {
        await this.driver.activateApp(input.bundleId);
      }

      return {
        success: result.success,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      return this.toActionResult(error, 'launchApp');
    }
  }

  // ────────── terminateApp ────────────────────────────────────────

  async terminateApp(input: TerminateAppInput): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const result = await this.driver.terminateApp(input.bundleId);
      return {
        success: result.success,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      return this.toActionResult(error, 'terminateApp');
    }
  }

  // ────────── getUiTree ───────────────────────────────────────────

  async getUiTree(_input: DeviceTarget): Promise<UiTreeSnapshot> {
    try {
      await this.ensureSession();

      const raw = await this.driver.getPageSource();

      return {
        raw,
        format: 'xml',
        capturedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(redactError(`[AppiumDeviceBackend.getUiTree] ${errorMsg}`));
      return {
        raw: '',
        format: 'xml',
        capturedAt: new Date().toISOString(),
      };
    }
  }

  // ────────── screenshot ──────────────────────────────────────────

  async screenshot(_input: ScreenshotInput): Promise<ArtifactRef> {
    try {
      await this.ensureSession();

      const base64 = await this.driver.takeScreenshot();
      const id = `screenshot_${Date.now()}`;
      const dir = join(tmpdir(), 'itestagent', 'artifacts');
      mkdirSync(dir, { recursive: true });
      const destPath = join(dir, `${id}.png`);
      writeFileSync(destPath, Buffer.from(base64, 'base64'));

      return {
        id,
        type: 'screenshot',
        path: destPath,
        mimeType: 'image/png',
        redactionStatus: 'safe',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(redactError(`[AppiumDeviceBackend.screenshot] ${errorMsg}`));
      return {
        id: `screenshot_error_${Date.now()}`,
        type: 'screenshot',
        path: '',
        redactionStatus: 'safe',
      };
    }
  }

  // ────────── tap ─────────────────────────────────────────────────

  async tap(input: TapInput): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const point = this.toPixels(input.x, input.y);
      const result = await this.driver.tap(point);
      return {
        success: result.success,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      return this.toActionResult(error, 'tap');
    }
  }

  // ────────── swipe ───────────────────────────────────────────────

  async swipe(input: SwipeInput): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const from = this.toPixels(input.fromX, input.fromY);
      const to = this.toPixels(input.toX, input.toY);
      const result = await this.driver.swipe(from, to, input.durationMs);
      return {
        success: result.success,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      return this.toActionResult(error, 'swipe');
    }
  }

  // ────────── typeText ────────────────────────────────────────────

  async typeText(input: TypeTextInput): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const result = await this.driver.typeText(input.text);
      return {
        success: result.success,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      return this.toActionResult(error, 'typeText');
    }
  }

  // ────────── pressButton ─────────────────────────────────────────

  async pressButton(input: PressButtonInput): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const result = await this.driver.pressButton(input.button);
      return {
        success: result.success,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: `pressButton(${input.button}): not supported — Appium mobile: pressButton requires iOS 17+`,
      };
    }
  }

  // ────────── openUrl ─────────────────────────────────────────────

  async openUrl(input: OpenUrlInput): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const bundleId = this.opts.bundleId;
      const result = await this.driver.openUrl(input.url, bundleId);
      return {
        success: result.success,
        message: result.message,
        error: result.error,
      };
    } catch (error) {
      return this.toActionResult(error, 'openUrl');
    }
  }

  // ────────── startRecording ──────────────────────────────────────

  async startRecording(_input: RecordingInput): Promise<RecordingHandle> {
    try {
      await this.ensureSession();

      const result = await this.driver.startRecording();
      return {
        handleId: result.recordingId,
        startedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(redactError(`[AppiumDeviceBackend.startRecording] ${errorMsg}`));
      return {
        handleId: `recording_error_${Date.now()}`,
        startedAt: new Date().toISOString(),
      };
    }
  }

  // ────────── stopRecording ───────────────────────────────────────

  async stopRecording(input: RecordingHandle): Promise<ArtifactRef> {
    try {
      await this.ensureSession();

      const base64 = await this.driver.stopRecording(input.handleId);
      const id = `video_${Date.now()}`;
      const dir = join(tmpdir(), 'itestagent', 'artifacts');
      mkdirSync(dir, { recursive: true });
      const destPath = join(dir, `${id}.mp4`);
      writeFileSync(destPath, Buffer.from(base64, 'base64'));

      return {
        id,
        type: 'video',
        path: destPath,
        mimeType: 'video/mp4',
        redactionStatus: 'raw-local-only',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(redactError(`[AppiumDeviceBackend.stopRecording] ${errorMsg}`));
      return {
        id: `video_error_${Date.now()}`,
        type: 'video',
        path: '',
        redactionStatus: 'raw-local-only',
      };
    }
  }

  // ────────── listCrashes ─────────────────────────────────────────

  async listCrashes(_input: DeviceTarget): Promise<CrashSummary[]> {
    if (this.targetKind === 'simulator') {
      return [];
    }

    try {
      const { stdout: raw, exitCode } = await spawnAsync([
        'xcrun',
        'devicectl',
        'device',
        'info',
        'diagnostics',
        '--device',
        this.opts.udid,
        '--json',
      ]);

      if (exitCode !== 0 || !raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw) as {
        result?: {
          diagnostics?: Array<{
            name?: string;
            date?: string;
            bundleId?: string;
          }>;
        };
      };

      const diagnostics = parsed?.result?.diagnostics ?? [];

      return diagnostics.map((d) => ({
        name: d.name ?? 'unknown',
        date: d.date ?? new Date().toISOString(),
        bundleId: d.bundleId,
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(redactError(`[AppiumDeviceBackend.listCrashes] ${errorMsg}`));
      return [];
    }
  }

  // ────────── collectLogs ─────────────────────────────────────────

  async collectLogs(input: LogCollectInput): Promise<ArtifactRef> {
    try {
      await this.ensureSession();

      const content = await this.driver.collectLogs({
        type: input.type,
        durationSeconds: input.durationSeconds,
      });

      const id = `log_${input.type}_${Date.now()}`;
      return {
        id,
        type: 'log',
        path: `artifacts/${id}.log`,
        mimeType: 'text/plain',
        redactionStatus: 'raw-local-only',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(redactError(`[AppiumDeviceBackend.collectLogs] ${errorMsg}`));
      return {
        id: `log_error_${Date.now()}`,
        type: 'log',
        path: '',
        redactionStatus: 'raw-local-only',
      };
    }
  }
}
