import { createXcodeProjAnalyzerBackend } from 'itestagent-backends-analyzer-xcodeproj';
import {
  createAppiumDeviceBackend,
  createAppiumDeviceDiscoveryProvider,
} from 'itestagent-backends-device-appium';
import type { DeviceBackend, DeviceDiscoveryProvider, DeviceInfo } from 'itestagent-contracts';
import {
  type ProjectAnalysisResult,
  analyzeProject,
  saveProfile,
} from 'itestagent-project-analyzer';

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
