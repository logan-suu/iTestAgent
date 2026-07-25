/**
 * Composition Root — production wiring for AppiumDeviceBackend.
 *
 * Wires RealAppiumDriver + WdaManager + AppiumDeviceBackend together
 * in a real production context. This is the canonical entry point for
 * constructing a production-ready AppiumDeviceBackend (Gate 4.4).
 *
 * Every dependency is created and injected explicitly — no hidden
 * global state, no implicit singletons.
 *
 * R2: Uses RealAppiumDriver (wraps webdriverio), not a mock.
 * R5: Configuration errors throw immediately — no silent fallback.
 */

import type { TargetKind } from 'itestagent-contracts';
import type { WdaStartupMode } from './appium-capabilities.js';
import { AppiumDeviceBackend } from './appium-device-backend.js';
import type { AppiumDeviceBackendOptions } from './appium-device-backend.js';
import { RealAppiumDriver } from './real-appium-driver.js';
import { WdaManager } from './wda-manager.js';
import type { WdaManagerOptions } from './wda-manager.js';

// ─── Configuration type ────────────────────────────────────────────────

/** Configuration for creating a production AppiumDeviceBackend. */
export interface ProductionAppiumConfig {
  /** Device UDID (required). */
  udid: string;
  /** Target kind: physical or simulator. */
  targetKind: TargetKind;
  /** App bundle ID to test. */
  bundleId?: string;
  /**
   * WDA base bundle ID (physical only).
   * MUST be base ID WITHOUT .xctrunner suffix.
   */
  wdaBaseBundleId?: string;
  /**
   * WDA startup mode (physical only).
   * Default: 'preinstalled' (Route A).
   */
  wdaStartupMode?: WdaStartupMode;
  /**
   * WDA URL for external-url mode.
   * Required when wdaStartupMode is 'external-url'.
   */
  webDriverAgentUrl?: string;
  /** WDA local port (default: 8100). */
  wdaLocalPort?: number;
  /** MJPEG server port (default: 9100). */
  mjpegServerPort?: number;
  /** Device display name. */
  deviceName?: string;
  /** iOS version string. */
  platformVersion?: string;
  /** Custom derived data path. */
  derivedDataPath?: string;
  /** Appium server URL (default: http://127.0.0.1:4723). */
  appiumServerUrl?: string;
  /** Staging directory for WDA build artifacts. */
  wdaStagingDir?: string;
}

/**
 * Factory output: the assembled backend plus its managed dependencies.
 *
 * The caller is responsible for calling backend.closeSession() to
 * tear down WDA and release ports. The caller also owns the WdaManager
 * reference for preinstalled WDA preparation workflows.
 */
export interface AppiumBackendAssembly {
  /** The production-ready AppiumDeviceBackend. */
  backend: AppiumDeviceBackend;
  /**
   * The WdaManager instance (if created).
   * Available for preinstalled WDA preparation and lifecycle control.
   */
  wdaManager?: WdaManager;
  /** The RealAppiumDriver instance (wraps webdriverio). */
  realDriver: RealAppiumDriver;
}

// ─── Factory function ────────────────────────────────────────────────

/**
 * Create a production-ready AppiumDeviceBackend with all dependencies wired.
 *
 * For simulator targetKind, WdaManager is not created (Appium auto-builds WDA).
 * For physical targetKind, WdaManager is created according to wdaStartupMode.
 *
 * The assembled backend uses the given configuration; Appium server is assumed
 * to already be running at appiumServerUrl (default: http://127.0.0.1:4723).
 *
 * @throws {Error} If required options for the given mode are missing.
 */
export function createAppiumDeviceBackend(config: ProductionAppiumConfig): AppiumBackendAssembly {
  const targetKind = config.targetKind;
  const wdaStartupMode: WdaStartupMode = config.wdaStartupMode ?? 'preinstalled';
  const appiumServerUrl = config.appiumServerUrl ?? 'http://127.0.0.1:4723';

  const realDriver = new RealAppiumDriver(appiumServerUrl);

  let wdaManager: WdaManager | undefined;

  // Only create WdaManager for physical devices
  if (targetKind === 'physical') {
    // WdaManager is needed for all physical modes
    // (preinstalled: verify; external-url: launch+wait; managed-xcodebuild: launch)
    const wdaOpts: WdaManagerOptions = {};
    if (config.wdaStagingDir) {
      wdaOpts.stagingDir = config.wdaStagingDir;
    }
    wdaManager = new WdaManager(wdaOpts);
  }

  // Validate mode-specific requirements
  if (targetKind === 'physical' && wdaStartupMode === 'external-url' && !config.webDriverAgentUrl) {
    throw new Error(
      'webDriverAgentUrl is required for external-url mode. ' +
        'Provide the WDA URL (e.g. "http://127.0.0.1:8100") or switch wdaStartupMode.',
    );
  }

  const backendOptions: AppiumDeviceBackendOptions = {
    udid: config.udid,
    targetKind,
    bundleId: config.bundleId,
    wdaBundleId: config.wdaBaseBundleId,
    wdaStartupMode,
    webDriverAgentUrl: config.webDriverAgentUrl,
    wdaLocalPort: config.wdaLocalPort,
    mjpegServerPort: config.mjpegServerPort,
    deviceName: config.deviceName,
    platformVersion: config.platformVersion,
    derivedDataPath: config.derivedDataPath,
    wdaManager,
  };

  const backend = new AppiumDeviceBackend(realDriver, backendOptions);

  return { backend, wdaManager, realDriver };
}
