import { createXcodeProjAnalyzerBackend } from 'itestagent-backends-analyzer-xcodeproj';
import {
  type ProductionAppiumConfig,
  createAppiumDeviceBackend,
  createAppiumDeviceDiscoveryProvider,
} from 'itestagent-backends-device-appium';
import type {
  BackendCleanupOutcome,
  BuildDestination,
  DeviceBackend,
  DeviceDiscoveryProvider,
  DeviceInfo,
  TestPlan,
} from 'itestagent-contracts';
import {
  type ProjectAnalysisResult,
  analyzeProject,
  saveProfile,
} from 'itestagent-project-analyzer';
import {
  type DeviceBackendDispatchInput,
  createDualExecutionDispatcher,
} from './dual-execution-dispatcher.js';
import { runXcunitFlow } from './test-flow/run-xcunit-flow.js';
import { createRealXcunitFlowDeps } from './test-flow/xcunit-flow-wiring.js';

export interface ProductionAgentSessionDependencies {
  analyzeWorkspace(workspace: string): Promise<ProjectAnalysisResult>;
  deviceDiscovery: DeviceDiscoveryProvider;
  createDeviceBackend(device: DeviceInfo): DeviceBackend;
  closeDeviceBackend?(backend: DeviceBackend, signal?: AbortSignal): Promise<BackendCleanupOutcome>;
}

export interface ProductionAgentSessionOptions {
  appium?: Omit<ProductionAppiumConfig, 'udid' | 'targetKind' | 'deviceName'>;
}

/**
 * Engine-owned production composition for the TUI session facade.
 * Runtime calls still flow through ToolDispatcher and PermissionEngine.
 */
export function createProductionAgentSessionDependencies(
  options: ProductionAgentSessionOptions = {},
): ProductionAgentSessionDependencies {
  return {
    analyzeWorkspace: async (workspace) => {
      const analysis = await analyzeProject(createXcodeProjAnalyzerBackend(), workspace);
      saveProfile(analysis.profile);
      return analysis;
    },
    deviceDiscovery: createAppiumDeviceDiscoveryProvider(),
    createDeviceBackend: (device) =>
      createAppiumDeviceBackend({
        ...options.appium,
        udid: device.udid,
        targetKind: device.targetKind,
        ...(device.name ? { deviceName: device.name } : {}),
        ...(options.appium?.platformVersion
          ? { platformVersion: options.appium.platformVersion }
          : device.osVersion
            ? { platformVersion: device.osVersion }
            : {}),
      }).backend,
    closeDeviceBackend: async (backend, signal) => {
      const outcome = await backend.closeSession?.(signal);
      return outcome ?? { status: 'already_closed', reusable: true, issues: [] };
    },
  };
}

/** Revalidate the confirmed XCUITest assets on the selected platform without touching a device. */
export async function revalidateProductionXcuitest(input: {
  plan: TestPlan;
  workspace: string;
  destination: BuildDestination;
  signal?: AbortSignal;
}): Promise<{ ready: boolean; reason?: string }> {
  input.signal?.throwIfAborted();
  const selected = input.plan.execution.xcuitest;
  if (!selected) return { ready: false, reason: 'confirmed XCUITest configuration is missing' };
  const backend = createXcodeProjAnalyzerBackend();
  if (!backend.discoverXcuitestExecutionAssets) {
    return { ready: false, reason: 'project analyzer cannot revalidate XCUITest execution assets' };
  }
  const discovery = await backend.discover(input.workspace);
  input.signal?.throwIfAborted();
  const graph = await backend.graph(discovery);
  input.signal?.throwIfAborted();
  const assets = await backend.discoverXcuitestExecutionAssets({
    root: input.workspace,
    discovery,
    xcuitestTargets: graph.xcuitestTargets ?? [],
    targetKind: input.plan.device.kind,
    destination: input.destination,
  });
  input.signal?.throwIfAborted();
  const match = assets.configurations.find(
    (configuration) =>
      configuration.scheme === selected.scheme &&
      configuration.testPlan === selected.testPlan &&
      (selected.targets ?? []).every((target) => configuration.targets.includes(target)),
  );
  return match
    ? { ready: true }
    : {
        ready: false,
        reason: `confirmed XCUITest configuration changed: ${assets.limitations.join('; ') || 'scheme/test plan/targets no longer enumerate'}`,
      };
}

/** Production composition; DeviceBackend action planning remains supplied by its owning lane. */
export function createProductionDualExecutionDispatcher(
  runDeviceBackend: (input: DeviceBackendDispatchInput) => Promise<unknown>,
) {
  const xcunitDeps = createRealXcunitFlowDeps();
  return createDualExecutionDispatcher({
    runXcuitest: (input) => runXcunitFlow(input, xcunitDeps),
    runDeviceBackend,
    revalidateXcuitest: revalidateProductionXcuitest,
  });
}
