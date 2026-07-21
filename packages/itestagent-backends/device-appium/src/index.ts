/**
 * itestagent-backends-device-appium
 *
 * DeviceBackend implementation using Appium/WDA for physical iOS devices.
 *
 * Exports:
 *   - AppiumDeviceBackend: DeviceBackend implementation (physical targetKind)
 *   - AppiumDriver: abstract interface for DI/testability
 *   - AppiumDriverError: typed error class
 *   - buildPhysicalCapabilities: W3C capabilities builder
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

export { buildPhysicalCapabilities } from './appium-capabilities.js';
export type { PhysicalCapabilitiesOptions } from './appium-capabilities.js';
