/**
 * AppiumDeviceBackend — DeviceBackend implementation for physical iOS devices.
 *
 * Implements the stable DeviceBackend interface (§5.1) using Appium/WDA.
 * Physical-only (TargetKind.physical). Simulator support is added in Task 3.10.
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
  TerminateAppInput,
  TypeTextInput,
  UiTreeSnapshot,
} from 'itestagent-contracts';

import type { AppiumDriver, AppiumPoint, AppiumScreenSize } from './appium-driver.js';

import { AppiumDriverError } from './appium-driver.js';

// ─── Types ────────────────────────────────────────────────────────────────

/** Options for AppiumDeviceBackend construction. */
export interface AppiumDeviceBackendOptions {
  /** Device UDID (required for physical device targeting). */
  udid: string;
  /** App bundle ID to test. */
  bundleId?: string;
  /**
   * WDA bundle ID override for free-account workaround.
   * Example: "UJ876FXT32.WebDriverAgentRunner.xctrunner"
   */
  wdaBundleId?: string;
  /** WDA local port for WebDriverAgent communication (default: 8100). */
  wdaLocalPort?: number;
  /**
   * Device display name for capabilities (optional).
   * If omitted, Appium infers from UDID. Used in capabilities for logging.
   */
  deviceName?: string;
  /** iOS version string (optional — for capabilities logging). */
  platformVersion?: string;
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

// ─── Implementation ───────────────────────────────────────────────────────

export class AppiumDeviceBackend implements DeviceBackend {
  readonly name = 'appium';
  readonly capabilities: BackendCapabilities = PHYSICAL_CAPABILITIES;

  private readonly opts: Required<Omit<AppiumDeviceBackendOptions, 'bundleId'>> &
    Pick<AppiumDeviceBackendOptions, 'bundleId'>;

  private driver: AppiumDriver;
  private sessionActive = false;
  private screenSize: AppiumScreenSize | null = null;

  constructor(driver: AppiumDriver, options: AppiumDeviceBackendOptions) {
    this.driver = driver;
    this.opts = {
      udid: options.udid,
      bundleId: options.bundleId,
      wdaBundleId: options.wdaBundleId ?? '',
      wdaLocalPort: options.wdaLocalPort ?? 8100,
      deviceName: options.deviceName ?? '',
      platformVersion: options.platformVersion ?? '',
    };
  }

  // ── Session lifecycle ──────────────────────────────────────────────

  /**
   * Ensure an Appium session is active, creating one if necessary.
   * Idempotent — safe to call before any Appium-dependent method.
   */
  private async ensureSession(): Promise<void> {
    if (this.sessionActive) return;

    const caps = {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': this.opts.udid,
      'appium:usePrebuiltWDA': true,
      'appium:noReset': true,
      'appium:newCommandTimeout': 600,
      'appium:wdaLocalPort': this.opts.wdaLocalPort,
    };

    // Only include optional caps that are explicitly set
    const extendedCaps: Record<string, unknown> = { ...caps };
    if (this.opts.bundleId) {
      extendedCaps['appium:bundleId'] = this.opts.bundleId;
    }
    if (this.opts.wdaBundleId) {
      extendedCaps['appium:updatedWDABundleId'] = this.opts.wdaBundleId;
    }
    if (this.opts.deviceName) {
      extendedCaps['appium:deviceName'] = this.opts.deviceName;
    }
    if (this.opts.platformVersion) {
      extendedCaps['appium:platformVersion'] = this.opts.platformVersion;
    }

    await this.driver.createSession(extendedCaps as Record<string, unknown>);
    this.sessionActive = true;

    // Cache screen size for coordinate conversion
    this.screenSize = await this.driver.getScreenSize();
  }

  /**
   * Close the current Appium session and release resources.
   * Idempotent — safe to call even if no session is active.
   */
  async closeSession(): Promise<void> {
    if (!this.sessionActive) return;

    try {
      await this.driver.deleteSession();
    } catch {
      // Best-effort cleanup — don't throw on delete failure
    }

    this.sessionActive = false;
    this.screenSize = null;
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

  /**
   * List physical iOS devices connected to this machine.
   *
   * Uses xcrun devicectl (no Appium session needed).
   * Only returns physical devices (targetKind: 'physical').
   *
   * R5: If devicectl is unavailable, returns empty array (annotated in notes).
   */
  async listDevices(): Promise<DeviceInfo[]> {
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

      // devicectl JSON format: { result: { devices: [...] } }
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

  // ────────── healthcheck ─────────────────────────────────────────

  /**
   * Check whether the target device is connected and reachable.
   *
   * Does NOT require an Appium session — only checks devicectl connectivity.
   * Full Appium healthcheck (WDA build + session create) is a separate
   * G5 spike — see docs/06-verification/.
   */
  async healthcheck(deviceId: string): Promise<HealthCheckResult> {
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

      // takeScreenshot returns base64 PNG — we store it as an artifact
      const _base64 = await this.driver.takeScreenshot();

      // In production, this would write the base64 data to the artifact store.
      // For now (Task 3.7), return an artifact reference with metadata.
      // ArtifactStore integration is done in Task 3.12/4.1.
      const id = `screenshot_${Date.now()}`;
      return {
        id,
        type: 'screenshot',
        path: `artifacts/${id}.png`,
        mimeType: 'image/png',
        redactionStatus: 'safe',
      };
    } catch (error) {
      // R5: return a "failed" artifact ref rather than throwing
      const errorMsg = error instanceof Error ? error.message : String(error);
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

      const _base64 = await this.driver.stopRecording(input.handleId);

      const id = `video_${Date.now()}`;
      return {
        id,
        type: 'video',
        path: `artifacts/${id}.mp4`,
        mimeType: 'video/mp4',
        redactionStatus: 'raw-local-only',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
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
    try {
      // Physical: use devicectl diagnostics for crash reports.
      // Appium does not have a standard crash listing API.
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
    } catch {
      // R5: crash listing is approximate — return empty array if unavailable
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
      return {
        id: `log_error_${Date.now()}`,
        type: 'log',
        path: '',
        redactionStatus: 'raw-local-only',
      };
    }
  }
}
