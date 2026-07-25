/**
 * itestagent-backends-device-appium
 *
 * DeviceBackend implementation using Appium/WDA for physical + simulator iOS devices.
 *
 * ADR-011: Dual targetKind support — devicectl for physical, simctl for simulator.
 * ADR-012: WdaManager owns WDA lifecycle. Appium handles WebDriver session only.
 *
 * Phase 3: Three mutually exclusive WdaStartupModes (preinstalled / external-url / managed-xcodebuild).
 *
 * Exports:
 *   - AppiumDeviceBackend: DeviceBackend implementation (dual-target: physical + simulator)
 *   - AppiumDriver: abstract interface for DI/testability
 *   - AppiumDriverError: typed error class
 *   - buildPhysicalCapabilities: W3C capabilities builder (physical, three startup modes)
 *   - buildSimulatorCapabilities: W3C capabilities builder (simulator, G5-SIM verified)
 *   - WdaManager: WDA lifecycle manager (build/install/launch/readiness/stop)
 *   - WdaStartupMode: discriminated union for WDA startup strategy
 *   - WdaBundleIdCanon: canonical bundle ID model (base + runner)
 *   - createAppiumDeviceBackend: composition root factory
 *   - redactError / redactErrorMessage: PII redaction
 *
 * R2: Uses Appium/WDA (mature open-source), does not re-implement device control.
 * R9: Component name is "appium" (registered in BackendRegistry as 'appium').
 */

export { AppiumDeviceBackend } from './appium-device-backend.js';
export type { AppiumDeviceBackendOptions } from './appium-device-backend.js';

export { AppiumDriverError } from './appium-driver.js';
export type {
  AppiumAppEntry,
  AppiumCrashEntry,
  AppiumDriver,
  AppiumElementRef,
  AppiumLogOptions,
  AppiumPoint,
  AppiumRecordingOptions,
  AppiumRecordingResult,
  AppiumRect,
  AppiumActionResult,
  AppiumScreenSize,
  AppiumSession,
  AppiumW3CCapabilities,
  AppiumDriverErrorCode,
} from './appium-driver.js';

export { RealAppiumDriver } from './real-appium-driver.js';

export { buildPhysicalCapabilities, buildSimulatorCapabilities } from './appium-capabilities.js';
export type {
  PhysicalCapabilitiesOptions,
  SimulatorCapabilitiesOptions,
  WdaStartupMode,
  WdaBundleIdCanon,
} from './appium-capabilities.js';
export { toRunnerBundleId, toBundleIdCanon } from './appium-capabilities.js';

export { WdaManager } from './wda-manager.js';
export type {
  WdaBuildOptions,
  WdaBuildResult,
  WdaInstallOptions,
  WdaInstallResult,
  WdaLaunchOptions,
  WdaLaunchResult,
  WdaStatusResult,
  WdaVersionInfo,
  WdaPreinstallVerification,
  WdaManagerOptions,
} from './wda-manager.js';

export { createAppiumDeviceBackend } from './composition-root.js';
export type { ProductionAppiumConfig, AppiumBackendAssembly } from './composition-root.js';

export { redactError, redactErrorMessage } from './redactor.js';
