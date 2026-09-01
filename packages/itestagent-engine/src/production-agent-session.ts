import { createXcodeProjAnalyzerBackend } from 'itestagent-backends-analyzer-xcodeproj';
import {
  createAppiumDeviceBackend,
  createAppiumDeviceDiscoveryProvider,
} from 'itestagent-backends-device-appium';
import type {
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
}

/**
 * Engine-owned production composition for the TUI session facade.
 * Runtime calls still flow through ToolDispatcher and PermissionEngine.
 */
export function createProductionAgentSessionDependencies(): ProductionAgentSessionDependencies {
  return {
    analyzeWorkspace: async (workspace) => {
      const analysis = await analyzeProject(createXcodeProjAnalyzerBackend(), workspace);
      saveProfile(analysis.profile);
      return analysis;
    },
    deviceDiscovery: createAppiumDeviceDiscoveryProvider(),
    createDeviceBackend: (device) =>
      createAppiumDeviceBackend({
        udid: device.udid,
        targetKind: device.targetKind,
        ...(device.name ? { deviceName: device.name } : {}),
        ...(device.osVersion ? { platformVersion: device.osVersion } : {}),
      }).backend,
  };
}

/** Revalidate the confirmed XCUITest assets on the selected platform without touching a device. */
export async function revalidateProductionXcuitest(input: {
  plan: TestPlan;
  workspace: string;
  destination: BuildDestination;
}): Promise<{ ready: boolean; reason?: string }> {
  const selected = input.plan.execution.xcuitest;
  if (!selected) return { ready: false, reason: 'confirmed XCUITest configuration is missing' };
  const backend = createXcodeProjAnalyzerBackend();
  if (!backend.discoverXcuitestExecutionAssets) {
    return { ready: false, reason: 'project analyzer cannot revalidate XCUITest execution assets' };
  }
  const discovery = await backend.discover(input.workspace);
  const graph = await backend.graph(discovery);
  const assets = await backend.discoverXcuitestExecutionAssets({
    root: input.workspace,
    discovery,
    xcuitestTargets: graph.xcuitestTargets ?? [],
    targetKind: input.plan.device.kind,
    destination: input.destination,
  });
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
