/**
 * Appium W3C capabilities builders for physical and simulator iOS targets.
 *
 * Physical: free-account workaround from Phase 0 cross-evaluation (T0.2b).
 * Simulator: no code signing needed — Appium auto-builds WDA (G5-SIM T1.6 verified).
 *
 * ADR-011: iOS Simulator first-class support — separate capability builder per targetKind.
 *
 * R5: All optional / inferred fields are documented with their uncertainty.
 */

import type { AppiumW3CCapabilities } from './appium-driver.js';

// ─── Physical device defaults ──────────────────────────────────────────

/** Default WDA local port (avoid conflict with other Appium sessions). */
export const DEFAULT_WDA_PORT = 8100;

/** Default mjpeg server port for video streaming. */
export const DEFAULT_MJPEG_PORT = 9100;

/** Default new command timeout (seconds) — how long Appium waits before auto-deleting session. */
export const DEFAULT_COMMAND_TIMEOUT = 600;

// ─── Builder ───────────────────────────────────────────────────────────

/**
 * Options for building physical device capabilities.
 */
export interface PhysicalCapabilitiesOptions {
  /** Device UDID (required). */
  udid: string;
  /** App bundle ID to test (optional — can be set later via launchApp). */
  bundleId?: string;
  /** WDA bundle ID override for free-account workaround (e.g. "UJ876FXT32.WebDriverAgentRunner.xctrunner"). */
  wdaBundleId?: string;
  /** WDA local port (default: 8100). */
  wdaLocalPort?: number;
  /** MJPEG server port (default: 9100). */
  mjpegServerPort?: number;
  /** Device display name (optional — Appium infers from UDID). */
  deviceName?: string;
  /** iOS version string (optional). */
  platformVersion?: string;
  /**
   * Whether to use prebuilt WDA instead of letting Appium build it.
   * Default: true (use workaround: manually build WDA once, then reuse).
   */
  usePrebuiltWDA?: boolean;
  /** Custom derived data path for WDA builds. */
  derivedDataPath?: string;
  /**
   * Whether to reset app state on session start.
   * Default: false (preserve app state across sessions).
   */
  fullReset?: boolean;
  /**
   * New command timeout in seconds (default: 600 = 10 minutes).
   */
  newCommandTimeout?: number;
}

/**
 * Build W3C capabilities for a physical iOS device session.
 *
 * Phase 0 T0.2b verified: free account works with:
 *   1. usePrebuiltWDA: true
 *   2. updatedWDABundleId: "<TEAMID>.WebDriverAgentRunner.xctrunner"
 *   3. Manually build WDA once with -allowProvisioningUpdates
 *
 * Re-run G5 spike after every Xcode/WDA version upgrade to verify capabilities.
 */
export function buildPhysicalCapabilities(
  opts: PhysicalCapabilitiesOptions,
): AppiumW3CCapabilities {
  const caps: AppiumW3CCapabilities = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': opts.udid,
    'appium:usePrebuiltWDA': opts.usePrebuiltWDA ?? true,
    'appium:noReset': !(opts.fullReset ?? false),
    'appium:newCommandTimeout': opts.newCommandTimeout ?? DEFAULT_COMMAND_TIMEOUT,
    'appium:wdaLocalPort': opts.wdaLocalPort ?? DEFAULT_WDA_PORT,
    'appium:mjpegServerPort': opts.mjpegServerPort ?? DEFAULT_MJPEG_PORT,
  };

  if (opts.bundleId) {
    caps['appium:bundleId'] = opts.bundleId;
  }

  if (opts.wdaBundleId) {
    caps['appium:updatedWDABundleId'] = opts.wdaBundleId;
  }

  if (opts.deviceName) {
    caps['appium:deviceName'] = opts.deviceName;
  }

  if (opts.platformVersion) {
    caps['appium:platformVersion'] = opts.platformVersion;
  }

  if (opts.derivedDataPath) {
    caps['appium:derivedDataPath'] = opts.derivedDataPath;
  }

  return caps;
}

// ─── Simulator device capabilities ─────────────────────────────────────

/**
 * Options for building simulator device capabilities.
 *
 * ADR-011: Simulator WDA does not require code signing — Appium handles
 * the build automatically. No `updatedWDABundleId` needed.
 *
 * G5-SIM T1.6 verified:
 *   1. Simulator WDA auto-builds in ~45s (first run)
 *   2. Parallel sessions need unique wdaLocalPort/mjpegServerPort/derivedDataPath
 *   3. usePrebuiltWDA: false (let Appium build, no signing overhead)
 */
export interface SimulatorCapabilitiesOptions {
  /** Simulator UDID (required). */
  udid: string;
  /** App bundle ID to test (optional — can be set later via launchApp). */
  bundleId?: string;
  /** WDA local port (default: 8100). Use unique port for parallel sessions. */
  wdaLocalPort?: number;
  /** MJPEG server port (default: 9100). Use unique port for parallel sessions. */
  mjpegServerPort?: number;
  /** Device display name (optional — Appium infers from UDID). */
  deviceName?: string;
  /** iOS version string (optional). */
  platformVersion?: string;
  /**
   * Whether to use prebuilt WDA instead of letting Appium build it.
   * Default: false — Appium auto-builds WDA for simulator (no signing needed).
   */
  usePrebuiltWDA?: boolean;
  /**
   * Custom derived data path for WDA builds.
   * Required for parallel sessions to avoid build conflicts.
   */
  derivedDataPath?: string;
  /**
   * Whether to reset app state on session start.
   * Default: false (preserve app state across sessions).
   */
  fullReset?: boolean;
  /**
   * New command timeout in seconds (default: 600 = 10 minutes).
   */
  newCommandTimeout?: number;
}

/**
 * Build W3C capabilities for a simulator iOS session.
 *
 * G5-SIM T1.6 verified: Appium auto-builds WDA on first run (~45s).
 * No code signing required — no `updatedWDABundleId` field.
 *
 * Parallel sessions (G5-SIM finding #5):
 *   Each session needs unique wdaLocalPort, mjpegServerPort, and derivedDataPath.
 *   The SessionManager is responsible for assigning non-conflicting ports.
 *
 * Re-run G5-SIM after every Xcode/WDA version upgrade to verify capabilities.
 */
export function buildSimulatorCapabilities(
  opts: SimulatorCapabilitiesOptions,
): AppiumW3CCapabilities {
  const caps: AppiumW3CCapabilities = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': opts.udid,
    'appium:usePrebuiltWDA': opts.usePrebuiltWDA ?? false,
    'appium:noReset': !(opts.fullReset ?? false),
    'appium:newCommandTimeout': opts.newCommandTimeout ?? DEFAULT_COMMAND_TIMEOUT,
    'appium:wdaLocalPort': opts.wdaLocalPort ?? DEFAULT_WDA_PORT,
    'appium:mjpegServerPort': opts.mjpegServerPort ?? DEFAULT_MJPEG_PORT,
  };

  if (opts.bundleId) {
    caps['appium:bundleId'] = opts.bundleId;
  }

  if (opts.deviceName) {
    caps['appium:deviceName'] = opts.deviceName;
  }

  if (opts.platformVersion) {
    caps['appium:platformVersion'] = opts.platformVersion;
  }

  if (opts.derivedDataPath) {
    caps['appium:derivedDataPath'] = opts.derivedDataPath;
  }

  return caps;
}
