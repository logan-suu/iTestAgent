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
import type { SimulatorCapabilitiesOptions } from './appium-capabilities.js';
import { buildPhysicalCapabilities } from './appium-capabilities.js';
import { AppiumDriverError } from './appium-driver.js';
import type { WdaManager } from './wda-manager.js';

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
   * WDA bundle ID override for free-account workaround (physical only).
   * Example: "UJ876FXT32.WebDriverAgentRunner.xctrunner"
   */
  wdaBundleId?: string;
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
   * WdaManager instance for managing WDA lifecycle (ADR-012).
   * When provided, WDA is launched before Appium session creation
   * and stopped on closeSession. Optional for mock/testing.
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
    Omit<AppiumDeviceBackendOptions, 'bundleId' | 'wdaBundleId' | 'derivedDataPath' | 'wdaManager'>
  > &
    Pick<AppiumDeviceBackendOptions, 'bundleId' | 'wdaBundleId' | 'derivedDataPath'>;

  private readonly targetKind: TargetKind;
  private driver: AppiumDriver;
  private readonly wdaManager: WdaManager | undefined;
  private sessionActive = false;
  private sessionMutex: Promise<void> | null = null;
  private screenSize: AppiumScreenSize | null = null;

  constructor(driver: AppiumDriver, options: AppiumDeviceBackendOptions) {
    this.driver = driver;
    this.targetKind = options.targetKind;
    this.wdaManager = options.wdaManager;
    this.opts = {
      udid: options.udid,
      targetKind: options.targetKind,
      bundleId: options.bundleId,
      wdaBundleId: options.wdaBundleId,
      wdaLocalPort: options.wdaLocalPort ?? 8100,
      mjpegServerPort: options.mjpegServerPort ?? 9100,
      deviceName: options.deviceName ?? '',
      platformVersion: options.platformVersion ?? '',
      derivedDataPath: options.derivedDataPath,
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
   * ADR-012: If a WdaManager is configured, WDA is launched before
   * the Appium session is established.
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

  private async doCreateSession(): Promise<void> {
    // ADR-012: launch WDA before Appium session if WdaManager is configured
    if (this.wdaManager && !this.wdaManager.isRunning()) {
      await this.wdaManager.launch({
        projectPath: '', // WDA project path is configured per-deployment
        udid: this.opts.udid,
        wdaPort: this.opts.wdaLocalPort,
      });
    }

    let caps: Record<string, unknown>;

    if (this.targetKind === 'simulator') {
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
      caps = buildSimulatorCapabilities(simOpts) as Record<string, unknown>;
    } else {
      caps = buildPhysicalCapabilities({
        udid: this.opts.udid,
        wdaLocalPort: this.opts.wdaLocalPort,
        newCommandTimeout: 600,
        usePrebuiltWDA: true,
        bundleId: this.opts.bundleId,
        wdaBundleId: this.opts.wdaBundleId || undefined,
        deviceName: this.opts.deviceName || undefined,
        platformVersion: this.opts.platformVersion || undefined,
      }) as Record<string, unknown>;
    }

    await this.driver.createSession(caps);
    this.sessionActive = true;

    // Cache screen size for coordinate conversion
    this.screenSize = await this.driver.getScreenSize();
  }

  /**
   * Close the current Appium session and release resources.
   *
   * ADR-012: If a WdaManager is configured, the WDA process is
   * stopped after the Appium session is deleted.
   *
   * Idempotent — safe to call even if no session is active.
   */
  async closeSession(): Promise<void> {
    // Wait for any in-flight session creation to complete
    if (this.sessionMutex) {
      try {
        await this.sessionMutex;
      } catch {
        /* session creation failed */
      }
    }

    if (!this.sessionActive) return;

    try {
      await this.driver.deleteSession();
    } catch {
      // Best-effort cleanup — don't throw on delete failure
    }

    this.sessionActive = false;
    this.screenSize = null;

    // ADR-012: stop WDA after Appium session is torn down
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
      const proc = Bun.spawnSync({
        cmd: ['xcrun', 'devicectl', 'list', 'devices', '--json'],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (proc.exitCode !== 0) {
        return [];
      }

      const raw = proc.stdout.toString().trim();
      if (!raw) return [];

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
      const proc = Bun.spawnSync({
        cmd: ['xcrun', 'simctl', 'list', 'devices', '--json'],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (proc.exitCode !== 0) {
        return [];
      }

      const raw = proc.stdout.toString().trim();
      if (!raw) return [];

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
      const proc = Bun.spawnSync({
        cmd: ['xcrun', 'devicectl', 'list', 'devices', '--json'],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (proc.exitCode !== 0) {
        return {
          healthy: false,
          details: 'devicectl unavailable — ensure Xcode CLI tools are installed',
        };
      }

      const raw = proc.stdout.toString().trim();
      const parsed = JSON.parse(raw) as {
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
      const proc = Bun.spawnSync({
        cmd: ['xcrun', 'simctl', 'list', 'devices', '--json'],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (proc.exitCode !== 0) {
        return {
          healthy: false,
          details: 'simctl unavailable — ensure Xcode CLI tools are installed',
        };
      }

      const raw = proc.stdout.toString().trim();
      if (!raw) {
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
      // R5: return empty array instead of throwing — caller checks context
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AppiumDeviceBackend.listApps] ${errorMsg}`);
      return [];
    }
  }

  // ────────── launchApp ───────────────────────────────────────────

  async launchApp(input: LaunchAppInput): Promise<ActionResult> {
    try {
      await this.ensureSession();

      // Use Appium mobile: launchApp (handles install+launch)
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
      // R5: return empty snapshot with error context rather than throwing
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AppiumDeviceBackend.getUiTree] ${errorMsg}`);
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
      // R5: return a "failed" artifact ref rather than throwing
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AppiumDeviceBackend.screenshot] ${errorMsg}`);
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
      // R5: pressButton may not be supported (WDA limitation with some iOS versions)
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
      // R5: return a "failed" handle — caller should check stopRecording result
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AppiumDeviceBackend.startRecording] ${errorMsg}`);
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
      console.error(`[AppiumDeviceBackend.stopRecording] ${errorMsg}`);
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
      // R5: Simulator crash log listing is not supported via simctl.
      // Crash diagnostics for simulator apps live in ~/Library/Logs/DiagnosticReports/
      // and are not queryable through a standard CLI. Return empty — caller must
      // interpret this as "not available for this target kind."
      return [];
    }

    try {
      const proc = Bun.spawnSync({
        cmd: [
          'xcrun',
          'devicectl',
          'device',
          'info',
          'diagnostics',
          '--device',
          this.opts.udid,
          '--json',
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (proc.exitCode !== 0) {
        return [];
      }

      const raw = proc.stdout.toString().trim();
      if (!raw) return [];

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
      console.error(`[AppiumDeviceBackend.listCrashes] ${errorMsg}`);
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
      // R5: log collection may not be available (WDA limitation)
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AppiumDeviceBackend.collectLogs] ${errorMsg}`);
      return {
        id: `log_error_${Date.now()}`,
        type: 'log',
        path: '',
        redactionStatus: 'raw-local-only',
      };
    }
  }
}
