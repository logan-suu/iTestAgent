import { describe, expect, test } from 'bun:test';
import { PermissionEngine } from '../src/permission-engine.js';
import { createPhysicalPreflightDeps } from '../src/physical-preflight-wiring.js';

function createDeps(permissionEngine = PermissionEngine.fromRules([])) {
  let installCalls = 0;
  const deps = createPhysicalPreflightDeps({
    deviceBackend: {
      healthcheck: async () => ({ healthy: true }),
      probePhysicalReadiness: async () => ({
        route: 'route_b_wda_manager_managed',
        stage: 'ready',
        ready: true,
        targetDeviceUdid: 'device-1',
        targetWdaBundleId: 'com.example.wda.xctrunner',
        waitedMs: 1,
      }),
    },
    devicectl: {
      isAppInstalled: async () => ({ success: true, installed: false }),
      installApp: async () => {
        installCalls += 1;
        return { success: true };
      },
      launchApp: async () => ({ success: true }),
    },
    permissionEngine,
  });
  return { deps, installCalls: () => installCalls };
}

describe('physical preflight production wiring', () => {
  test('does not invoke a backend operation after cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const { deps, installCalls } = createDeps();

    await expect(deps.installApp('device-1', '/tmp/App.app', controller.signal)).rejects.toThrow(
      'cancelled',
    );
    expect(installCalls()).toBe(0);
  });

  test('cancels a pending permission ask with the same signal', async () => {
    const permissionEngine = PermissionEngine.fromRules([]);
    const { deps } = createDeps(permissionEngine);
    const controller = new AbortController();
    const pending = deps.requestPermission(
      'call-1',
      'replace_device_app',
      'device-1:com.example.app',
      controller.signal,
    );

    controller.abort(new Error('run cancelled'));
    await expect(pending).rejects.toThrow('physical preflight aborted');
  });
});
