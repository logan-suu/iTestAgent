/**
 * itestagent-backends-device-appium
 *
 * DeviceBackend implementation using Appium/WDA for physical + simulator iOS devices.
 *
 * ADR-011: Dual targetKind support — devicectl for physical, simctl for simulator.
 *
 * Exports:
 *   - AppiumDeviceBackend: DeviceBackend implementation (dual-target: physical + simulator)
 *   - AppiumDriver: abstract interface for DI/testability
 *   - AppiumDriverError: typed error class
 *   - buildPhysicalCapabilities: W3C capabilities builder (physical)
 *   - buildSimulatorCapabilities: W3C capabilities builder (simulator, G5-SIM verified)
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
} from './appium-capabilities.js';

export { WdaManager } from './wda-manager.js';
export type {
  WdaBuildOptions,
  WdaBuildResult,
  WdaInstallOptions,
  WdaInstallResult,
  WdaLaunchOptions,
  WdaLaunchResult,
} from './wda-manager.js';
