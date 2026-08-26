/**
 *
 * B13 module split: Appium server/process/session/wda handles live in
 * appium-process-manager / appium-session-lifecycle / owned-wda-processes /
 * appium-process-liveness / wda-active-application; this module stays the
 * capability vocabulary.

 * Appium W3C capabilities builders for physical and simulator iOS targets.
 *
 * Physical: three mutually exclusive WDA startup modes (Phase 3 Gate 4.1).
 * Simulator: no code signing needed — Appium auto-builds WDA (G5-SIM T1.6 verified).
 *
 * ADR-011: iOS Simulator first-class support — separate capability builder per targetKind.
 * ADR-012: iTestAgent owns WDA lifecycle via WdaManager. Appium is WebDriver protocol layer.
 *
 * R5: All optional / inferred fields are documented with their uncertainty.
 */

import type { AppiumW3CCapabilities } from './appium-driver.js';

// ─── WDA startup mode ──────────────────────────────────────────────────

/**
 * WDA startup mode discriminator.
 *
 * Mutually exclusive — only ONE mode applies per session.
 *
 * - 'managed-xcodebuild': Appium builds + signs + launches WDA (default for paid accounts).
 *   Passes xcodeOrgId + xcodeSigningId + allowProvisioningDeviceRegistration.
 *
 * - 'preinstalled': WDA is already built, signed, and installed on the device.
 *   Appium skips ALL xcodebuild. Requires iOS 17+. Use after WdaManager.preparePreinstalledWDA().
 *
 * - 'external-url': WDA is running externally (launched by iTestAgent WdaManager).
 *   Appium connects via webDriverAgentUrl. Use when iTestAgent manages WDA lifecycle completely.
 */
export type WdaStartupMode = 'managed-xcodebuild' | 'preinstalled' | 'external-url';

// ─── Bundle ID canonical model ─────────────────────────────────────────

/**
 * Canonical WDA Bundle ID model.
 *
 * Gate 2: XCUITest scheme auto-appends .xctrunner suffix, so Appium's
 * `updatedWDABundleId` must receive the BASE ID (no suffix).
 * Passing "TEAMID.WebDriverAgentRunner.xctrunner" results in
 * "TEAMID.WebDriverAgentRunner.xctrunner.xctrunner" (double-suffix bug).
 */
export interface WdaBundleIdCanon {
  /** Base bundle ID — "TEAMID.WebDriverAgentRunner" (NO .xctrunner suffix). */
  base: string;
  /** Actual Runner bundle ID — "TEAMID.WebDriverAgentRunner.xctrunner". */
  runner: string;
}

/** Derive the runner (actual) bundle ID from a base ID. */
export function toRunnerBundleId(base: string): string {
  if (base.endsWith('.xctrunner')) {
    throw new Error(`wdaBundleId must be the base ID (without .xctrunner suffix), got: ${base}`);
  }
  return `${base}.xctrunner`;
}

/** Derive the canonical model from a base ID. */
export function toBundleIdCanon(base: string): WdaBundleIdCanon {
  return { base, runner: toRunnerBundleId(base) };
}

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
  /**
   * WDA base bundle ID for free-account workaround.
   * MUST be the base ID WITHOUT .xctrunner suffix (e.g. "TEAMID.WebDriverAgentRunner").
   * XCUITest scheme auto-appends .xctrunner — do NOT include it here.
   */
  wdaBundleId?: string;
  /**
   * WDA startup mode. Mutually exclusive — only ONE mode per session.
   * Default: 'preinstalled' (primary Route A strategy for free accounts).
   */
  wdaStartupMode?: WdaStartupMode;
  /**
   * For 'external-url' mode: WDA URL (e.g. "http://127.0.0.1:8100").
   * Required when wdaStartupMode is 'external-url'.
   */
  webDriverAgentUrl?: string;
  /**
   * For 'managed-xcodebuild' mode: Team ID for code signing.
   */
  xcodeOrgId?: string;
  /**
   * For 'managed-xcodebuild' mode: signing identity (default: "Apple Development").
   */
  xcodeSigningId?: string;
  /**
   * For 'managed-xcodebuild' mode: allow provisioning updates.
   */
  allowProvisioningDeviceRegistration?: boolean;
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
   * Only valid for 'managed-xcodebuild' mode. Skips build-for-testing only.
   * Default: false in managed-xcodebuild, ignored in other modes.
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
 * Three mutually exclusive WDA startup modes:
 *
 *   'preinstalled' (Route A, default):
 *     - Generates usePreinstalledWDA: true (NOT usePrebuiltWDA)
 *     - Generates updatedWDABundleId (base ID, no .xctrunner)
 *     - Skips ALL Appium xcodebuild — WDA must already be on device
 *     - iOS 17+ required
 *
 *   'external-url' (Route B, fallback):
 *     - Generates webDriverAgentUrl
 *     - Appium connects to externally-running WDA without xcodebuild
 *     - Requires WdaManager to have launched WDA and confirmed ready
 *
 *   'managed-xcodebuild' (Route C, diagnostic):
 *     - Appium manages xcodebuild with optional signing parameters
 *     - usePrebuiltWDA can be used to skip build-for-testing only
 *     - xcodeOrgId/xcodeSigningId/allowProvisioningDeviceRegistration passed through
 *
 * Validation: conflicting mode-specific options cause an immediate error.
 */
export function buildPhysicalCapabilities(
  opts: PhysicalCapabilitiesOptions,
): AppiumW3CCapabilities {
  const mode: WdaStartupMode = opts.wdaStartupMode ?? 'preinstalled';

  // ── Validate mutual exclusivity ───────────────────────────────────
  if (mode === 'preinstalled') {
    if (opts.webDriverAgentUrl) {
      throw new Error(
        'Conflicting capabilities: webDriverAgentUrl is not allowed in preinstalled mode. ' +
          'Use external-url mode or remove webDriverAgentUrl.',
      );
    }
    if (opts.xcodeOrgId || opts.xcodeSigningId || opts.allowProvisioningDeviceRegistration) {
      throw new Error(
        'Conflicting capabilities: xcodeOrgId/xcodeSigningId/allowProvisioningDeviceRegistration ' +
          'are not allowed in preinstalled mode. Use managed-xcodebuild mode or remove signing options.',
      );
    }
  }

  if (mode === 'external-url') {
    if (opts.usePrebuiltWDA) {
      throw new Error(
        'Conflicting capabilities: usePrebuiltWDA is not allowed in external-url mode. ' +
          'External URL mode bypasses all xcodebuild.',
      );
    }
    if (opts.xcodeOrgId || opts.xcodeSigningId || opts.allowProvisioningDeviceRegistration) {
      throw new Error(
        'Conflicting capabilities: xcodeOrgId/xcodeSigningId/allowProvisioningDeviceRegistration ' +
          'are not allowed in external-url mode.',
      );
    }
  }

  if (mode === 'managed-xcodebuild') {
    if (opts.webDriverAgentUrl) {
      throw new Error(
        'Conflicting capabilities: webDriverAgentUrl is not allowed in managed-xcodebuild mode.',
      );
    }
  }

  // ── Validate wdaBundleId has no .xctrunner suffix ─────────────────
  if (opts.wdaBundleId?.endsWith('.xctrunner')) {
    throw new Error(
      `wdaBundleId must be the base ID without .xctrunner suffix. Got "${opts.wdaBundleId}" — XCUITest scheme auto-appends .xctrunner, resulting in double suffix. Use the base ID instead (e.g. "TEAMID.WebDriverAgentRunner").`,
    );
  }

  // ── Base capabilities (common to all physical modes) ──────────────
  const caps: AppiumW3CCapabilities = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': opts.udid,
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

  // ── Mode-specific capabilities ────────────────────────────────────
  switch (mode) {
    case 'preinstalled':
      // Route A: usePreinstalledWDA skips ALL Appium xcodebuild
      // (NOT usePrebuiltWDA — that only skips build-for-testing)
      caps['appium:usePreinstalledWDA'] = true;

      if (opts.wdaBundleId) {
        // Base ID only — Appium/XCUITest scheme auto-appends .xctrunner
        caps['appium:updatedWDABundleId'] = opts.wdaBundleId;
      }
      break;

    case 'external-url':
      // Route B: connect to externally-running WDA
      if (!opts.webDriverAgentUrl) {
        throw new Error(
          'webDriverAgentUrl is required for external-url mode. ' +
            'Provide the WDA URL (e.g. "http://127.0.0.1:8100").',
        );
      }
      caps['appium:webDriverAgentUrl'] = opts.webDriverAgentUrl;
      break;

    case 'managed-xcodebuild':
      // Route C: Appium manages xcodebuild
      if (opts.usePrebuiltWDA) {
        caps['appium:usePrebuiltWDA'] = opts.usePrebuiltWDA;
      }
      if (opts.wdaBundleId) {
        caps['appium:updatedWDABundleId'] = opts.wdaBundleId;
      }
      if (opts.xcodeOrgId) {
        caps['appium:xcodeOrgId'] = opts.xcodeOrgId;
      }
      if (opts.xcodeSigningId) {
        caps['appium:xcodeSigningId'] = opts.xcodeSigningId;
      }
      if (opts.allowProvisioningDeviceRegistration) {
        caps['appium:allowProvisioningDeviceRegistration'] =
          opts.allowProvisioningDeviceRegistration;
      }
      break;
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
