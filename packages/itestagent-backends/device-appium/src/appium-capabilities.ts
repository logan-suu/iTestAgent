/**
 * Appium W3C capabilities builder for physical iOS devices.
 *
 * Builds the capabilities object used to create an Appium session targeting
 * a specific physical iPhone. Follows the free-account workaround from
 * Phase 0 cross-evaluation (T0.2b).
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
