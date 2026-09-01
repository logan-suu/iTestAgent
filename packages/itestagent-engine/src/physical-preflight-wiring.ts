import type { DevicectlOps } from 'itestagent-backends-build-xcodebuild';
import type { AppiumDeviceBackend } from 'itestagent-backends-device-appium';
import type { PhysicalRoute } from 'itestagent-contracts';
import type { PermissionEngine } from './permission-engine.js';
import type { PhysicalPreflightCoordinatorDeps } from './physical-preflight-coordinator.js';

export interface PhysicalPreflightWiringInput {
  deviceBackend: Pick<AppiumDeviceBackend, 'healthcheck' | 'probePhysicalReadiness'>;
  devicectl: Pick<DevicectlOps, 'isAppInstalled' | 'installApp' | 'launchApp'>;
  permissionEngine: Pick<PermissionEngine, 'requestPermission'>;
  prepareWda?(
    route: PhysicalRoute,
    signal?: AbortSignal,
  ): Promise<{
    success: boolean;
    error?: string;
  }>;
  createCallId?: () => string;
}

/** Wire production backends through the Engine-owned preflight boundary. */
export function createPhysicalPreflightDeps(
  input: PhysicalPreflightWiringInput,
): PhysicalPreflightCoordinatorDeps {
  return {
    healthcheck: (deviceUdid, signal) => input.deviceBackend.healthcheck(deviceUdid, signal),
    isAppInstalled: async (deviceUdid, bundleId) => {
      const state = await input.devicectl.isAppInstalled(deviceUdid, bundleId);
      if (!state.success) {
        throw new Error(state.error ?? 'devicectl app inventory failed.');
      }
      return state.installed;
    },
    installApp: (deviceUdid, appPath) => input.devicectl.installApp(deviceUdid, appPath),
    launchApp: (deviceUdid, bundleId) => input.devicectl.launchApp(deviceUdid, bundleId),
    probeWda: () => input.deviceBackend.probePhysicalReadiness(),
    ...(input.prepareWda ? { prepareWda: input.prepareWda } : {}),
    requestPermission: (callId, action, resource) =>
      input.permissionEngine.requestPermission(callId, action, resource),
    createCallId:
      input.createCallId ?? (() => `physical-preflight-${globalThis.crypto.randomUUID()}`),
  };
}
