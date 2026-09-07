import { describe, expect, test } from 'bun:test';
import type { DeviceBackend, DeviceInfo, PhysicalAppArtifact } from 'itestagent-contracts';
import { TestPlanSchema } from 'itestagent-contracts';
import { createProductionPhysicalPreflight } from '../src/production-physical-preflight.js';

const device: DeviceInfo = {
  udid: 'DEVICE-1',
  platform: 'ios',
  targetKind: 'physical',
};

const plan = TestPlanSchema.parse({
  schemaVersion: 'itestagent.test-plan.v3',
  runId: 'run-physical-preflight',
  projectProfileRef:
    'projects/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/project-profile.json',
  target: { type: 'current_workspace' },
  device: { kind: 'physical', physical: { selector: 'by_udid', udid: device.udid } },
  appSource: { strategy: 'auto_from_workspace' },
  backendPreference: {},
  execution: {
    prefer: 'device_backend',
    fallback: 'device_backend',
    resolvedPath: 'device_backend',
    selectionReason: 'confirmed_no_xcuitest_candidate',
    features: ['Validation'],
    goal: 'Validate the application.',
    testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
    assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
  },
  artifacts: {
    collect: ['screenshot'],
    report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
  },
  performance: { baseline: 'skip', baselineDomain: 'physical', thresholdRequired: false },
  safety: { defaultMode: 'ask', highRiskActions: [] },
});

const artifact: PhysicalAppArtifact = {
  sourceKind: 'build',
  sourcePath: '/workspace/DerivedData/Demo.app',
  appPath: '/workspace/DerivedData/Demo.app',
  bundleId: 'com.example.Demo',
  executable: 'Demo',
  supportedPlatforms: ['iPhoneOS'],
  architectures: ['arm64'],
  signingValid: true,
};

describe('production physical preflight composition', () => {
  test('orders build, validation, install, launch, and active WDA readiness', async () => {
    const events: string[] = [];
    const preflight = createProductionPhysicalPreflight({
      findProjectFile: () => ({
        type: 'xcode_project',
        path: '/workspace/Demo.xcodeproj',
      }),
      resolveAppSource: () => ({
        kind: 'build_required',
        workspacePath: '/workspace',
        projectType: 'xcodeproj',
      }),
      buildForPhysical: async (input) => {
        events.push(`build:${input.scheme}:${input.udid}`);
        return { exitCode: 0, appPath: artifact.appPath, log: '' };
      },
      normalizePhysicalAppArtifact: async () => {
        events.push('validate');
        return artifact;
      },
      createDevicectlOps: () =>
        ({
          async isAppInstalled() {
            events.push('inventory');
            return { success: true, installed: true };
          },
          async installApp() {
            events.push('install');
            return { success: true };
          },
          async launchApp() {
            events.push('launch');
            return { success: true };
          },
        }) as never,
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });
    const backend = {
      async healthcheck() {
        events.push('health');
        return { healthy: true };
      },
      async probePhysicalReadiness() {
        events.push('wda');
        return {
          route: 'route_b_wda_manager_managed' as const,
          stage: 'ready' as const,
          ready: true,
          targetDeviceUdid: device.udid,
          targetWdaBundleId: 'TEAM.WebDriverAgentRunner.xctrunner',
          waitedMs: 1,
        };
      },
    } as unknown as DeviceBackend;

    const result = await preflight({
      plan,
      workspace: '/workspace',
      scheme: 'Demo',
      device,
      bundleId: artifact.bundleId,
      stagingDir: '/tmp/itestagent-preflight-test',
      backend,
      authorize: async (action) => {
        events.push(`permission:${action}`);
        return true;
      },
    });

    expect(result.status).toBe('ready');
    expect(events).toEqual([
      'build:Demo:DEVICE-1',
      'validate',
      'health',
      'inventory',
      'permission:replace_device_app',
      'install',
      'launch',
      'wda',
    ]);
  });

  test('stops before device operations when the build fails', async () => {
    let deviceOperation = false;
    const preflight = createProductionPhysicalPreflight({
      findProjectFile: () => ({
        type: 'xcode_project',
        path: '/workspace/Demo.xcodeproj',
      }),
      resolveAppSource: () => ({
        kind: 'build_required',
        workspacePath: '/workspace',
        projectType: 'xcodeproj',
      }),
      buildForPhysical: async () => ({ exitCode: 65, log: 'Code signing failed' }),
      createDevicectlOps: () => {
        deviceOperation = true;
        return {} as never;
      },
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });

    const result = await preflight({
      plan,
      workspace: '/workspace',
      scheme: 'Demo',
      device,
      bundleId: artifact.bundleId,
      stagingDir: '/tmp/itestagent-preflight-test',
      backend: {} as DeviceBackend,
      authorize: async () => true,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      stage: 'app_source',
      failure: { code: 'app_source_unresolved' },
    });
    expect(deviceOperation).toBe(false);
  });
});
