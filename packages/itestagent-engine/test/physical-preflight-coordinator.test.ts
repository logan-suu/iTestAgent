import { describe, expect, test } from 'bun:test';
import type { PhysicalAppArtifact, WdaReadinessProbe } from 'itestagent-contracts';
import {
  type PhysicalPreflightCoordinatorDeps,
  createPhysicalPreflightCoordinator,
} from '../src/physical-preflight-coordinator.js';

const artifact: PhysicalAppArtifact = {
  sourceKind: 'app',
  sourcePath: '/tmp/Example.app',
  appPath: '/tmp/Example.app',
  bundleId: 'com.example.app',
  executable: 'Example',
  supportedPlatforms: ['iPhoneOS'],
  architectures: ['arm64'],
  signingValid: true,
};

const readyWda: WdaReadinessProbe = {
  route: 'route_b_wda_manager_managed',
  stage: 'ready',
  ready: true,
  targetDeviceUdid: 'device-1',
  targetWdaBundleId: 'com.example.wda.xctrunner',
  waitedMs: 200,
};

function makeDeps(overrides: Partial<PhysicalPreflightCoordinatorDeps> = {}) {
  const calls: string[] = [];
  let id = 0;
  const deps: PhysicalPreflightCoordinatorDeps = {
    healthcheck: async () => ({ healthy: true }),
    isAppInstalled: async () => false,
    installApp: async () => {
      calls.push('install');
      return { success: true };
    },
    launchApp: async () => {
      calls.push('launch');
      return { success: true };
    },
    probeWda: async () => {
      calls.push('probe');
      return readyWda;
    },
    requestPermission: async (_callId, action) => {
      calls.push(`permission:${action}`);
      return { effect: 'allow' };
    },
    createCallId: () => `preflight-${++id}`,
    ...overrides,
  };
  return { deps, calls };
}

const input = {
  artifact,
  deviceUdid: 'device-1',
  route: 'route_b_wda_manager_managed' as const,
  confirmedTestPlan: true,
};

describe('physical preflight coordinator', () => {
  test('installs, launches, and actively probes WDA before reporting ready', async () => {
    const { deps, calls } = makeDeps();
    const result = await createPhysicalPreflightCoordinator(deps).run(input);

    expect(result.status).toBe('ready');
    expect(calls).toEqual(['install', 'launch', 'probe']);
  });

  test('requires replacement permission when the app is already installed', async () => {
    const { deps, calls } = makeDeps({ isAppInstalled: async () => true });
    const result = await createPhysicalPreflightCoordinator(deps).run(input);

    expect(result.status).toBe('ready');
    expect(calls[0]).toBe('permission:replace_device_app');
  });

  test('stops without installing when replacement permission is denied', async () => {
    const { deps, calls } = makeDeps({
      isAppInstalled: async () => true,
      requestPermission: async () => ({ effect: 'deny' }),
    });
    const result = await createPhysicalPreflightCoordinator(deps).run(input);

    expect(result.status).toBe('cancelled');
    expect(calls).toEqual([]);
  });

  test('does not treat installed WDA inventory as readiness', async () => {
    const { deps } = makeDeps({
      probeWda: async () => ({
        ...readyWda,
        stage: 'wda_inventory',
        ready: false,
        failureCode: 'wda_status_failed',
        details: 'Runner installed; active status not proven.',
      }),
    });
    const result = await createPhysicalPreflightCoordinator(deps).run(input);

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.stage).toBe('wda_inventory');
    }
  });

  test('gates WDA repair and re-probes after preparation', async () => {
    let probeCount = 0;
    const { deps, calls } = makeDeps({
      probeWda: async () => {
        calls.push('probe');
        probeCount += 1;
        return probeCount === 1
          ? {
              ...readyWda,
              stage: 'wda_launch',
              ready: false,
              failureCode: 'wda_launch_failed',
              details: 'WDA launch failed.',
            }
          : readyWda;
      },
      prepareWda: async () => {
        calls.push('prepare');
        return { success: true };
      },
    });
    const result = await createPhysicalPreflightCoordinator(deps).run({
      ...input,
      repairWdaWhenBlocked: true,
    });

    expect(result.status).toBe('ready');
    expect(calls).toEqual([
      'install',
      'launch',
      'probe',
      'permission:prepare_wda',
      'prepare',
      'probe',
    ]);
  });

  test('rejects a probe from a different WDA route', async () => {
    const { deps } = makeDeps({
      probeWda: async () => ({ ...readyWda, route: 'route_c_appium_managed' }),
    });
    const result = await createPhysicalPreflightCoordinator(deps).run(input);

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.failure.code).toBe('wda_route_not_selected');
    }
  });

  test('rejects readiness evidence from a different physical device', async () => {
    const { deps } = makeDeps({
      probeWda: async () => ({ ...readyWda, targetDeviceUdid: 'device-2' }),
    });
    const result = await createPhysicalPreflightCoordinator(deps).run(input);

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.failure.code).toBe('wda_identity_mismatch');
    }
  });

  test('revalidates route identity after WDA preparation', async () => {
    let probeCount = 0;
    const { deps } = makeDeps({
      probeWda: async () => {
        probeCount += 1;
        return probeCount === 1
          ? {
              ...readyWda,
              stage: 'wda_launch',
              ready: false,
              failureCode: 'wda_launch_failed',
            }
          : { ...readyWda, route: 'route_c_appium_managed' };
      },
      prepareWda: async () => ({ success: true }),
    });
    const result = await createPhysicalPreflightCoordinator(deps).run({
      ...input,
      repairWdaWhenBlocked: true,
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.failure.code).toBe('wda_route_not_selected');
    }
  });
});
