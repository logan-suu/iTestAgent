export { createXcodebuildBuildDriver } from './xcodebuild-build-driver.js';
export { pipeThroughXcbeautify } from './xcbeautify.js';
export {
  APP_SOURCE_STRATEGIES,
  resolveAppSource,
} from './app-source-resolver.js';
export type {
  AppSourceStrategy,
  AppSourceContext,
  AppSourceResolution,
  ProjectType,
} from './app-source-resolver.js';
export {
  PhysicalAppArtifactError,
  normalizePhysicalAppArtifact,
} from './physical-app-artifact.js';
export type { NormalizePhysicalAppArtifactInput } from './physical-app-artifact.js';
export type {
  SyncSpawnResult,
  AsyncSpawnResult,
  SpawnSyncFn,
  SpawnAsyncFn,
  BeautifyFn,
  FindAppPathFn,
  XcodebuildDriverDeps,
} from './xcodebuild-build-driver.js';

// Devicectl operations (US-6.2 AC1/AC4)
export { createDevicectlOps } from './devicectl-ops.js';
export type {
  DevicectlResult,
  DevicectlAppInstallState,
  DevicectlDeps,
  DevicectlOps,
} from './devicectl-ops.js';

// Signing diagnostics (US-6.2 AC3)
export { diagnoseSigningError, hasSigningError } from './signing-diagnostics.js';
export type { SigningDiagnostic } from './signing-diagnostics.js';

// ─── B12 module split: strict parsers, simctl ops, build/test flows ──
export {
  DevicectlParseError,
  parseStrictJsonObject,
  resolveFieldPath,
} from './devicectl-output.js';
export type { DevicectlParseErrorCode } from './devicectl-output.js';
export {
  DEVICECTL_DEVICE_ALIASES,
  parseDevicectlDetailsText,
  parseDevicectlListDevices,
  parseDevicectlProcesses,
} from './devicectl-processes.js';
export type {
  DevicectlDeviceEntry,
  DevicectlProcessEntry,
} from './devicectl-processes.js';
export { createSimctlOps } from './simctl-ops.js';
export type { SimctlDeviceEntry, SimctlOps } from './simctl-ops.js';
export { destinationArgs } from './xcodebuild-driver-support.js';
export { runXcodebuildTests } from './xcodebuild-test-runner.js';
export type {
  XcodebuildTestRunInput,
  XcodebuildTestRunOutput,
} from './xcodebuild-test-runner.js';
export { buildForSimulator } from './simulator-build.js';
export type { SimulatorBuildInput, SimulatorBuildOutput } from './simulator-build.js';
export { buildForPhysical } from './physical-build.js';
export type { PhysicalBuildInput, PhysicalBuildOutput } from './physical-build.js';
export type {
  XcodebuildProcessOptions,
  XcodebuildProcessResult,
  XcodebuildProcessRunner,
} from './xcodebuild-process-types.js';
