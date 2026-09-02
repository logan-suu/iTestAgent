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
 *   - Physical production routing: explicit external-url / managed-xcodebuild
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
  WdaReadinessProbe,
} from 'itestagent-contracts';

import type {
  AppiumDriver,
  AppiumPoint,
  AppiumScreenSize,
  AppiumSession,
} from './appium-driver.js';

import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSimulatorCapabilities } from './appium-capabilities.js';
import type { SimulatorCapabilitiesOptions, WdaStartupMode } from './appium-capabilities.js';
import { buildPhysicalCapabilities } from './appium-capabilities.js';
import { AppiumDriverError } from './appium-driver.js';
import { discoverPhysicalDevices, discoverSimulatorDevices } from './device-discovery.js';
import type { IProxyTunnel } from './iproxy-tunnel.js';
import { type RedactingLogger, createRedactingLogger, redactError } from './redactor.js';
import type { WdaManager } from './wda-manager.js';

// ─── Subprocess helper ─────────────────────────────────────────

async function spawnAsync(
  cmd: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(signal ? { signal } : {}),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
}

/**
 * True when a driver error is provably a pre-dispatch element-lookup failure
 * (no-such-element) — the click never reached the app, so a coordinate-tap
 * fallback cannot double-fire. Anything else (post-click failure, session
 * loss, network error) must propagate.
 */
function isElementLookupError(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.name, error.message);
  if (cause instanceof Error) parts.push(cause.name, cause.message);
  return /no such element|NoSuchElement/i.test(parts.join(' '));
}

// ─── Types ────────────────────────────────────────────────────────────────

/** Options for AppiumDeviceBackend construction. */
export type WdaStatusFetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AppiumDeviceBackendOptions {
  /** Device UDID (required). */
  udid: string;
  /** Execution target type: 'physical' (devicectl/xcodebuild) or 'simulator' (simctl/xcodebuild). */
  targetKind: TargetKind;
  /** App bundle ID to test. */
  bundleId?: string;
  /** Run-scoped directory for raw screenshot artifacts. */
  artifactDirectory?: string;
  /**
   * WDA base bundle ID for free-account workaround (physical only).
   * MUST be base ID WITHOUT .xctrunner suffix (e.g. "TEAMID.WebDriverAgentRunner").
   */
  wdaBundleId?: string;
  /**
   * WDA startup mode (physical only). Mutually exclusive — only ONE mode per session.
   * Physical callers must select external-url (Route B) or managed-xcodebuild (Route C).
   * Ignored for simulator targetKind.
   */
  wdaStartupMode?: WdaStartupMode;
  /**
   * WDA URL for external-url mode (physical only).
   * Required when wdaStartupMode is 'external-url'.
   */
  webDriverAgentUrl?: string;
  /** HTTP transport for Route B WDA status identity observation. */
  wdaStatusFetch?: WdaStatusFetchFn;
  /**
   * USB tunnel manager for real devices (G5 spike recipe): WDA listens on the
   * device's localhost only, so Route B needs `iproxy` before waitForReady can
   * reach 127.0.0.1. Optional — when omitted, an existing external tunnel is
   * assumed (simulators never need one).
   */
  iproxyTunnel?: IProxyTunnel;
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

  private readonly logger: RedactingLogger;

  private readonly opts: Required<
    Omit<
      AppiumDeviceBackendOptions,
      | 'bundleId'
      | 'artifactDirectory'
      | 'wdaBundleId'
      | 'iproxyTunnel'
      | 'derivedDataPath'
      | 'wdaManager'
      | 'webDriverAgentUrl'
      | 'wdaStatusFetch'
      | 'wdaProjectPath'
      | 'xcodeOrgId'
      | 'xcodeSigningId'
    >
  > &
    Pick<
      AppiumDeviceBackendOptions,
      | 'bundleId'
      | 'artifactDirectory'
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
  private readonly iproxyTunnel: IProxyTunnel | undefined;
  private readonly wdaStatusFetch: WdaStatusFetchFn;
  private sessionActive = false;
  private activeSession: AppiumSession | null = null;
  private sessionMutex: Promise<void> | null = null;
  private screenSize: AppiumScreenSize | null = null;

  constructor(driver: AppiumDriver, options: AppiumDeviceBackendOptions) {
    this.logger = createRedactingLogger('AppiumDeviceBackend');
    this.driver = driver;
    this.wdaStatusFetch = options.wdaStatusFetch ?? globalThis.fetch;
    this.targetKind = options.targetKind;
    this.wdaManager = options.wdaManager;
    this.iproxyTunnel = options.iproxyTunnel;
    if (options.targetKind === 'physical' && options.wdaStartupMode === undefined) {
      throw new Error(
        'Physical Appium sessions require an explicit WDA route: external-url (Route B) or managed-xcodebuild (Route C).',
      );
    }
    if (options.targetKind === 'physical' && options.wdaStartupMode === 'preinstalled') {
      throw new Error(
        'preinstalled is inventory-only and cannot establish physical WDA readiness; select Route B or Route C.',
      );
    }
    this.wdaStartupMode = options.wdaStartupMode ?? 'managed-xcodebuild';
    this.opts = {
      udid: options.udid,
      targetKind: options.targetKind,
      bundleId: options.bundleId,
      artifactDirectory: options.artifactDirectory,
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
   *   - preinstalled: rejected for physical production sessions (legacy capability only)
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

      this.activeSession = await this.driver.createSession(caps);
      this.sessionActive = true;

      this.screenSize = await this.driver.getScreenSize();
    } catch (error) {
      // Roll back session state: createSession may have succeeded while a
      // later setup step (getScreenSize) failed — leaving sessionActive=true
      // would make every later call reuse a dead session (CodeRabbit #10).
      if (this.sessionActive) {
        try {
          await this.driver.deleteSession();
        } catch {
          // Best-effort — the server may have already dropped it
        }
        this.sessionActive = false;
        this.activeSession = null;
        this.screenSize = null;
      }
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
      // Release the usbmux tunnel too — it may hold the local WDA port
      // after a failed attempt; the next attempt re-ensures it.
      this.iproxyTunnel?.stop();
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
   * Legacy Route A capability builder retained for historical spike compatibility.
   *
   * Physical production construction rejects this mode before it can execute;
   * installed inventory alone cannot establish readiness.
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
      mjpegServerPort: this.opts.mjpegServerPort,
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
    // Attach mode: an explicit webDriverAgentUrl means WDA is already hosted
    // (G5 recipe: xcodebuild test-without-building + external usbmux tunnel).
    // No WdaManager lifecycle is required — Appium attaches to the live server.
    if (this.opts.webDriverAgentUrl) {
      return buildPhysicalCapabilities({
        udid: this.opts.udid,
        wdaLocalPort: this.opts.wdaLocalPort,
        mjpegServerPort: this.opts.mjpegServerPort,
        newCommandTimeout: 600,
        wdaStartupMode: 'external-url',
        webDriverAgentUrl: this.opts.webDriverAgentUrl,
        bundleId: this.opts.bundleId,
        deviceName: this.opts.deviceName || undefined,
        platformVersion: this.opts.platformVersion || undefined,
      }) as Record<string, unknown>;
    }

    if (!this.wdaManager) {
      throw new Error(
        'wdaManager is required for external-url mode. Provide a WdaManager instance.',
      );
    }

    // G5 recipe: real devices need the usbmux tunnel BEFORE waitForReady can
    // reach 127.0.0.1 (WDA binds on the device's localhost only).
    this.iproxyTunnel?.ensure({
      udid: this.opts.udid,
      localPort: this.opts.wdaLocalPort,
      devicePort: 8100,
    });

    // Launch WDA
    if (!this.wdaManager.isRunning()) {
      await this.wdaManager.launch({
        projectPath: '', // Configured per-deployment via WdaManager
        udid: this.opts.udid,
        wdaPort: this.opts.wdaLocalPort,
        mjpegServerPort: this.opts.mjpegServerPort,
        teamId: this.opts.xcodeOrgId,
        codeSignIdentity: this.opts.xcodeSigningId,
        derivedDataPath: this.opts.derivedDataPath,
        productBundleIdentifier: this.opts.wdaBundleId,
      });
    }

    // Wait for WDA to be ready
    await this.wdaManager.waitForReady(this.opts.wdaLocalPort);

    const wdaUrl = this.opts.webDriverAgentUrl ?? `http://127.0.0.1:${this.opts.wdaLocalPort}`;

    return buildPhysicalCapabilities({
      udid: this.opts.udid,
      wdaLocalPort: this.opts.wdaLocalPort,
      mjpegServerPort: this.opts.mjpegServerPort,
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
        mjpegServerPort: this.opts.mjpegServerPort,
        derivedDataPath: this.opts.derivedDataPath,
        productBundleIdentifier: this.opts.wdaBundleId,
      });
    }

    return buildPhysicalCapabilities({
      udid: this.opts.udid,
      wdaLocalPort: this.opts.wdaLocalPort,
      mjpegServerPort: this.opts.mjpegServerPort,
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

    // Delete Appium session if active. G5 finding: WDA teardown can hang on
    // devicectl — bound by a 15s guard so callers never block forever.
    if (this.sessionActive) {
      try {
        await Promise.race([
          this.driver.deleteSession(),
          new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
        ]);
      } catch {
        // Best-effort cleanup — don't throw on delete failure
      }
      this.sessionActive = false;
      this.activeSession = null;
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

    // G5 recipe: tear down the usbmux tunnel with the session.
    this.iproxyTunnel?.stop();
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
        error: `[${error.code}] ${operation}: ${redactError(error.message)}`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `${operation}: ${redactError(message)}`,
    };
  }

  /** Create a success ActionResult. */
  private ok(message?: string): ActionResult {
    return { success: true, message: message ?? 'ok' };
  }

  // ── DeviceBackend interface ─────────────────────────────────────────

  // ────────── listDevices ─────────────────────────────────────────

  async listDevices(signal?: AbortSignal): Promise<DeviceInfo[]> {
    if (this.targetKind === 'simulator') {
      return discoverSimulatorDevices(signal);
    }
    return discoverPhysicalDevices(signal);
  }

  // ────────── healthcheck ─────────────────────────────────────────

  async healthcheck(deviceId: string, signal?: AbortSignal): Promise<HealthCheckResult> {
    if (this.targetKind === 'simulator') {
      return this.simulatorHealthcheck(deviceId, signal);
    }
    return this.physicalHealthcheck(deviceId, signal);
  }

  /**
   * Prove physical WDA readiness through the configured Route B/C session.
   * Installed-app inventory is deliberately insufficient (ADR-028 / DEF-031).
   */
  async probePhysicalReadiness(signal?: AbortSignal): Promise<WdaReadinessProbe> {
    signal?.throwIfAborted();
    if (this.targetKind !== 'physical') {
      throw new Error('Physical WDA readiness cannot be probed for a simulator backend.');
    }
    if (!this.opts.wdaBundleId) {
      throw new Error('Physical WDA readiness requires an explicit WDA bundle ID.');
    }

    const route =
      this.wdaStartupMode === 'external-url'
        ? 'route_b_wda_manager_managed'
        : 'route_c_appium_managed';
    const startedAt = Date.now();
    try {
      await this.ensureSession();
      if (signal?.aborted) {
        await this.closeSession();
        signal.throwIfAborted();
      }
      const expectedWdaBundleId = this.opts.wdaBundleId.endsWith('.xctrunner')
        ? this.opts.wdaBundleId
        : `${this.opts.wdaBundleId}.xctrunner`;
      const observedWdaBaseBundleId =
        this.wdaStartupMode === 'external-url'
          ? await this.observeExternalWdaBundleId(signal)
          : this.activeSession?.wdaBundleId;
      const observedWdaBundleId = observedWdaBaseBundleId?.endsWith('.xctrunner')
        ? observedWdaBaseBundleId
        : observedWdaBaseBundleId
          ? `${observedWdaBaseBundleId}.xctrunner`
          : undefined;
      if (
        this.activeSession?.deviceUdid !== this.opts.udid ||
        observedWdaBundleId !== expectedWdaBundleId
      ) {
        return {
          route,
          stage: 'wda_status',
          ready: false,
          targetDeviceUdid: this.activeSession?.deviceUdid ?? 'unobserved',
          targetWdaBundleId: observedWdaBundleId ?? 'unobserved',
          waitedMs: Date.now() - startedAt,
          failureCode: 'wda_identity_mismatch',
          details: 'The active route did not report the expected device and WDA bundle identities.',
        };
      }
      return {
        route,
        stage: 'ready',
        ready: true,
        targetDeviceUdid: this.activeSession.deviceUdid,
        targetWdaBundleId: observedWdaBundleId,
        waitedMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const signingFailure = /sign|provision|development team|xcodeorgid/iu.test(message);
      const tunnelFailure = /iproxy|tunnel|usbmux/iu.test(message);
      const launchFailure = /launch|xcodebuild/iu.test(message);
      const failureCode = signingFailure
        ? 'wda_signing_or_configuration_failed'
        : tunnelFailure
          ? 'wda_tunnel_failed'
          : this.wdaStartupMode === 'managed-xcodebuild'
            ? 'appium_session_failed'
            : launchFailure
              ? 'wda_launch_failed'
              : 'wda_status_failed';
      const stage = signingFailure
        ? 'wda_launch'
        : tunnelFailure
          ? 'wda_tunnel'
          : this.wdaStartupMode === 'managed-xcodebuild'
            ? 'appium_session'
            : launchFailure
              ? 'wda_launch'
              : 'wda_status';
      return {
        route,
        stage,
        ready: false,
        targetDeviceUdid: this.opts.udid,
        targetWdaBundleId: this.opts.wdaBundleId.endsWith('.xctrunner')
          ? this.opts.wdaBundleId
          : `${this.opts.wdaBundleId}.xctrunner`,
        waitedMs: Date.now() - startedAt,
        failureCode,
        details: message,
      };
    }
  }

  /**
   * Route B bypasses Appium's WDA startup, so returned Appium capabilities do
   * not reliably contain updatedWDABundleId. Observe the identity from the
   * active WDA endpoint instead of treating the requested capability as fact.
   */
  private async observeExternalWdaBundleId(signal?: AbortSignal): Promise<string | undefined> {
    const endpoint = new URL(
      this.opts.webDriverAgentUrl ?? `http://127.0.0.1:${this.opts.wdaLocalPort}`,
    );
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/u, '')}/status`;
    const timeout = AbortSignal.timeout(5_000);
    const response = await this.wdaStatusFetch(endpoint, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      throw new Error(`WDA status identity probe returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      value?: { build?: { productBundleIdentifier?: unknown } };
    };
    const bundleId = body.value?.build?.productBundleIdentifier;
    return typeof bundleId === 'string' && bundleId.length > 0 ? bundleId : undefined;
  }

  private async physicalHealthcheck(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<HealthCheckResult> {
    try {
      const devices = await discoverPhysicalDevices(signal);

      if (devices.length === 0) {
        return {
          healthy: false,
          details: 'devicectl unavailable — ensure Xcode CLI tools are installed',
        };
      }

      const found = devices.some((device) => device.udid === deviceId);

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

  private async simulatorHealthcheck(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<HealthCheckResult> {
    try {
      const { stdout: raw, exitCode } = await spawnAsync(
        ['xcrun', 'simctl', 'list', 'devices', '--json'],
        signal,
      );

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
        const found = deviceList.find((d) => (d as Record<string, unknown>).udid === deviceId) as
          | Record<string, unknown>
          | undefined;
        if (!found) continue;
        if (String(found.state ?? '').toLowerCase() !== 'booted') {
          return {
            healthy: false,
            details: `Simulator ${deviceId} is ${String(found.state ?? 'unknown')}; boot it before execution`,
          };
        }
        return { healthy: true };
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

  async listApps(_deviceId: string, signal?: AbortSignal): Promise<AppInfo[]> {
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
      this.logger.error(`[listApps] ${errorMsg}`);
      return [];
    }
  }

  // ────────── launchApp ───────────────────────────────────────────

  async launchApp(input: LaunchAppInput, signal?: AbortSignal): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const result = await this.driver.launchApp(input.bundleId);
      if (result.success) {
        await this.driver.activateApp(input.bundleId);
      }

      return {
        success: result.success,
        message: result.message,
        error: result.error ? redactError(result.error) : undefined,
      };
    } catch (error) {
      return this.toActionResult(error, 'launchApp');
    }
  }

  // ────────── terminateApp ────────────────────────────────────────

  async terminateApp(input: TerminateAppInput, signal?: AbortSignal): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const result = await this.driver.terminateApp(input.bundleId);
      return {
        success: result.success,
        message: result.message,
        error: result.error ? redactError(result.error) : undefined,
      };
    } catch (error) {
      return this.toActionResult(error, 'terminateApp');
    }
  }

  // ────────── getUiTree ───────────────────────────────────────────

  async getUiTree(_input: DeviceTarget, signal?: AbortSignal): Promise<UiTreeSnapshot> {
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
      this.logger.error(`[getUiTree] ${errorMsg}`);
      return {
        raw: '',
        format: 'xml',
        capturedAt: new Date().toISOString(),
      };
    }
  }

  // ────────── screenshot ──────────────────────────────────────────

  async screenshot(_input: ScreenshotInput, signal?: AbortSignal): Promise<ArtifactRef> {
    try {
      await this.ensureSession();

      const base64 = await this.driver.takeScreenshot();
      const screenshotBytes = Buffer.from(base64, 'base64');
      if (screenshotBytes.length === 0) {
        throw new Error('Screenshot capture returned empty content');
      }
      const id = `screenshot_${randomUUID()}`;
      const dir = this.opts.artifactDirectory ?? join(tmpdir(), 'itestagent', 'artifacts');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      const destPath = join(dir, `${id}.png`);
      writeFileSync(destPath, screenshotBytes, { mode: 0o600 });
      chmodSync(destPath, 0o600);

      return {
        id,
        type: 'screenshot',
        path: destPath,
        mimeType: 'image/png',
        redactionStatus: 'raw-local-only',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[screenshot] ${errorMsg}`);
      return {
        id: `screenshot_error_${Date.now()}`,
        type: 'screenshot',
        path: '',
        redactionStatus: 'safe',
      };
    }
  }

  // ────────── tap ─────────────────────────────────────────────────

  async tap(
    input: TapInput & { accessibilityId?: string },
    signal?: AbortSignal,
  ): Promise<ActionResult> {
    // G5 finding: raw coordinate taps don't register on SwiftUI buttons in this
    // setup — prefer WDA's element-resolved click when an accessibility
    // identifier is available, fall back to coordinates.
    const accId = (input as { accessibilityId?: string }).accessibilityId;
    if (accId) {
      try {
        await this.ensureSession();
        return await this.driver.tapElement(accId);
      } catch (error) {
        // Only fall through to the coordinate path when the element click
        // provably never dispatched (element lookup failed). A post-click
        // failure must not re-tap — the app may have already processed the
        // first tap (double-tap risk).
        if (!isElementLookupError(error)) {
          return this.toActionResult(error, 'tap');
        }
      }
    }
    try {
      await this.ensureSession();

      const point = this.toPixels(input.x, input.y);
      const result = await this.driver.tap(point);
      return {
        success: result.success,
        message: result.message,
        error: result.error ? redactError(result.error) : undefined,
      };
    } catch (error) {
      return this.toActionResult(error, 'tap');
    }
  }

  // ────────── swipe ───────────────────────────────────────────────

  async swipe(input: SwipeInput, signal?: AbortSignal): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const from = this.toPixels(input.fromX, input.fromY);
      const to = this.toPixels(input.toX, input.toY);
      const result = await this.driver.swipe(from, to, input.durationMs);
      return {
        success: result.success,
        message: result.message,
        error: result.error ? redactError(result.error) : undefined,
      };
    } catch (error) {
      return this.toActionResult(error, 'swipe');
    }
  }

  // ────────── typeText ────────────────────────────────────────────

  async typeText(input: TypeTextInput, signal?: AbortSignal): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const result = await this.driver.typeText(input.text);
      return {
        success: result.success,
        message: result.message,
        error: result.error ? redactError(result.error) : undefined,
      };
    } catch (error) {
      return this.toActionResult(error, 'typeText');
    }
  }

  // ────────── pressButton ─────────────────────────────────────────

  async pressButton(input: PressButtonInput, signal?: AbortSignal): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const result = await this.driver.pressButton(input.button);
      return {
        success: result.success,
        message: result.message,
        error: result.error ? redactError(result.error) : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: `pressButton(${input.button}): not supported — Appium mobile: pressButton requires iOS 17+`,
      };
    }
  }

  // ────────── openUrl ─────────────────────────────────────────────

  async openUrl(input: OpenUrlInput, signal?: AbortSignal): Promise<ActionResult> {
    try {
      await this.ensureSession();

      const bundleId = this.opts.bundleId;
      const result = await this.driver.openUrl(input.url, bundleId);
      return {
        success: result.success,
        message: result.message,
        error: result.error ? redactError(result.error) : undefined,
      };
    } catch (error) {
      return this.toActionResult(error, 'openUrl');
    }
  }

  // ────────── startRecording ──────────────────────────────────────

  async startRecording(_input: RecordingInput, signal?: AbortSignal): Promise<RecordingHandle> {
    try {
      await this.ensureSession();

      const result = await this.driver.startRecording();
      return {
        handleId: result.recordingId,
        startedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[startRecording] ${errorMsg}`);
      return {
        handleId: `recording_error_${Date.now()}`,
        startedAt: new Date().toISOString(),
      };
    }
  }

  // ────────── stopRecording ───────────────────────────────────────

  async stopRecording(input: RecordingHandle, signal?: AbortSignal): Promise<ArtifactRef> {
    try {
      await this.ensureSession();

      const base64 = await this.driver.stopRecording(input.handleId);
      const videoBytes = Buffer.from(base64, 'base64');
      if (videoBytes.length === 0) {
        throw new Error('Video capture returned empty content');
      }
      const id = `video_${randomUUID()}`;
      const dir = this.opts.artifactDirectory ?? join(tmpdir(), 'itestagent', 'artifacts');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      const destPath = join(dir, `${id}.mp4`);
      writeFileSync(destPath, videoBytes, { mode: 0o600 });
      chmodSync(destPath, 0o600);

      return {
        id,
        type: 'video',
        path: destPath,
        mimeType: 'video/mp4',
        redactionStatus: 'raw-local-only',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[stopRecording] ${errorMsg}`);
      return {
        id: `video_error_${Date.now()}`,
        type: 'video',
        path: '',
        redactionStatus: 'raw-local-only',
      };
    }
  }

  // ────────── listCrashes ─────────────────────────────────────────

  async listCrashes(_input: DeviceTarget, signal?: AbortSignal): Promise<CrashSummary[]> {
    if (this.targetKind === 'simulator') {
      return [];
    }

    try {
      const { stdout: raw, exitCode } = await spawnAsync(
        [
          'xcrun',
          'devicectl',
          'device',
          'info',
          'diagnostics',
          '--device',
          this.opts.udid,
          '--json',
        ],
        signal,
      );

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
      this.logger.error(`[listCrashes] ${errorMsg}`);
      return [];
    }
  }

  // ────────── collectLogs ─────────────────────────────────────────

  async collectLogs(input: LogCollectInput, signal?: AbortSignal): Promise<ArtifactRef> {
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
      this.logger.error(`[collectLogs] ${errorMsg}`);
      return {
        id: `log_error_${Date.now()}`,
        type: 'log',
        path: '',
        redactionStatus: 'raw-local-only',
      };
    }
  }
}
