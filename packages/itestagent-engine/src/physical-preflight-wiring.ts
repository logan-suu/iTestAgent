import type { DevicectlOps } from 'itestagent-backends-build-xcodebuild';
import type { AppiumDeviceBackend } from 'itestagent-backends-device-appium';
import type { PhysicalRoute } from 'itestagent-contracts';
import type { PermissionEngine } from './permission-engine.js';
import type { PhysicalPreflightCoordinatorDeps } from './physical-preflight-coordinator.js';

export interface PhysicalPreflightWiringInput {
  deviceBackend: Pick<AppiumDeviceBackend, 'healthcheck' | 'probePhysicalReadiness'>;
  devicectl: Pick<DevicectlOps, 'isAppInstalled' | 'installApp' | 'launchApp'>;
  permissionEngine: Pick<PermissionEngine, 'requestPermission' | 'cancel'>;
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
    isAppInstalled: async (deviceUdid, bundleId, signal) => {
      signal?.throwIfAborted();
      const state = await input.devicectl.isAppInstalled(deviceUdid, bundleId, signal);
      if (!state.success) {
        throw new Error(state.error ?? 'devicectl app inventory failed.');
      }
      return state.installed;
    },
    installApp: async (deviceUdid, appPath, signal) => {
      signal?.throwIfAborted();
      return input.devicectl.installApp(deviceUdid, appPath, signal);
    },
    launchApp: async (deviceUdid, bundleId, signal) => {
      signal?.throwIfAborted();
      return input.devicectl.launchApp(deviceUdid, bundleId, undefined, signal);
    },
    probeWda: async (_route, signal) => {
      signal?.throwIfAborted();
      return input.deviceBackend.probePhysicalReadiness(signal);
    },
    ...(input.prepareWda ? { prepareWda: input.prepareWda } : {}),
    requestPermission: async (callId, action, resource, signal) => {
      signal?.throwIfAborted();
      const onAbort = () => input.permissionEngine.cancel(callId, 'physical preflight aborted');
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        return await input.permissionEngine.requestPermission(callId, action, resource);
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
    createCallId:
      input.createCallId ?? (() => `physical-preflight-${globalThis.crypto.randomUUID()}`),
  };
}
