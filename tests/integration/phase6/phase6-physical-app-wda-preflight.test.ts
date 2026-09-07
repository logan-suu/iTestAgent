import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDevicectlOps,
  normalizePhysicalAppArtifact,
  resolveAppSource,
} from 'itestagent-backends-build-xcodebuild';
import type { XcodebuildProcessRunner } from 'itestagent-backends-build-xcodebuild';
import {
  type DeviceBackend,
  type PhysicalRoute,
  TestPlanSchema,
  type WdaReadinessProbe,
} from 'itestagent-contracts';
import {
  PermissionEngine,
  createPhysicalPreflightCoordinator,
  createProductionPhysicalPreflight,
} from 'itestagent-engine';

const roots: string[] = [];

function createPhysicalApp(): { root: string; appPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'itestagent-phase6-preflight-'));
  roots.push(root);
  const appPath = join(root, 'Example.app');
  mkdirSync(appPath);
  writeFileSync(join(appPath, 'Info.plist'), '<plist/>');
  writeFileSync(join(appPath, 'Example'), 'arm64-binary');
  return { root, appPath };
}

const validateRunner: XcodebuildProcessRunner = async (cmd, args) => {
  if (cmd === '/usr/bin/plutil') {
    const values: Record<string, string> = {
      CFBundleIdentifier: 'com.example.app',
      CFBundleExecutable: 'Example',
      CFBundleSupportedPlatforms: '["iPhoneOS"]',
    };
    return { exitCode: 0, stdout: values[args[1] as string] ?? '', stderr: '' };
  }
  if (cmd === '/usr/bin/lipo') {
    return { exitCode: 0, stdout: 'arm64', stderr: '' };
  }
  if (cmd === '/usr/bin/codesign') {
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  return { exitCode: 1, stdout: '', stderr: `Unexpected command: ${cmd}` };
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Phase 6 physical app/WDA preflight', () => {
  for (const createBuiltApp of [true, false]) {
    test(`production build passes its run-scoped artifact to validation/install (artifact exists: ${createBuiltApp})`, async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'itestagent-build-context-')));
      roots.push(root);
      const workspace = join(root, 'project with spaces');
      mkdirSync(join(workspace, 'Example.xcodeproj'), { recursive: true });
      const stagingDir = join(root, 'run', 'staging');
      const derivedData = join(stagingDir, 'DerivedData');
      const appPath = join(derivedData, 'Build/Products/Debug-iphoneos/Example.app');
      const buildCommands: string[][] = [];
      const operations: string[] = [];
      const preflight = createProductionPhysicalPreflight({
        runCommand: async (cmd, args, options) => {
          if (cmd !== 'xcodebuild') return validateRunner(cmd, args, options);
          expect(options?.cwd).toBe(workspace);
          buildCommands.push([...args]);
          const index = args.indexOf('-derivedDataPath');
          const directory = index < 0 ? join(root, 'default DerivedData') : args[index + 1];
          if (args[0] === 'build') {
            expect(directory).toBe(derivedData);
            if (createBuiltApp) {
              mkdirSync(appPath, { recursive: true });
              writeFileSync(join(appPath, 'Info.plist'), '<plist/>');
              writeFileSync(join(appPath, 'Example'), 'fixture-arm64-binary');
            }
            return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
          }
          return {
            exitCode: 0,
            stdout: `TARGET_BUILD_DIR = ${directory}/Build/Products/Debug-iphoneos\nFULL_PRODUCT_NAME = Example.app`,
            stderr: '',
          };
        },
        createDevicectlOps: () =>
          createDevicectlOps({
            spawnSync: () => {
              throw new Error('Unexpected synchronous device command');
            },
            spawnAsync: async (_cmd, args) => {
              if (args.includes('apps')) {
                operations.push('inventory');
                writeFileSync(args.at(-1) as string, JSON.stringify({ result: { apps: [] } }));
              } else if (args.includes('install')) {
                operations.push('install');
                expect(args).toContain(appPath);
                expect(existsSync(appPath)).toBe(true);
              } else if (args.includes('launch')) {
                operations.push('launch');
              } else {
                throw new Error('Unexpected device command');
              }
              return { exitCode: 0, stdout: '', stderr: '' };
            },
          }),
      });
      const plan = TestPlanSchema.parse({
        schemaVersion: 'itestagent.test-plan.v3',
        runId: 'run-build-context',
        projectProfileRef: `projects/${'a'.repeat(64)}/project-profile.json`,
        target: { type: 'current_workspace' },
        device: { kind: 'physical', physical: { selector: 'by_udid', udid: 'device-fixture' } },
        appSource: { strategy: 'auto_from_workspace' },
        backendPreference: { device: ['appium'] },
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
      const result = await preflight({
        plan,
        workspace,
        scheme: 'Example',
        device: { udid: 'device-fixture', platform: 'ios', targetKind: 'physical' },
        bundleId: 'com.example.app',
        stagingDir,
        backend: {
          healthcheck: async () => ({ healthy: true }),
          probePhysicalReadiness: async () => {
            operations.push('wda');
            return {
              route: 'route_b_wda_manager_managed',
              stage: 'ready',
              ready: true,
              targetDeviceUdid: 'device-fixture',
              targetWdaBundleId: 'com.example.wda',
              waitedMs: 0,
            };
          },
        } as unknown as DeviceBackend,
        authorize: async () => true,
      });

      if (createBuiltApp) {
        expect(result).toMatchObject({
          status: 'ready',
          artifact: { sourcePath: appPath, appPath },
        });
        expect(operations).toEqual(['inventory', 'install', 'launch', 'wda']);
      } else {
        expect(result).toMatchObject({ status: 'blocked', stage: 'artifact_validation' });
        expect(operations).toEqual([]);
      }
      expect(buildCommands).toHaveLength(2);
      for (const command of buildCommands) {
        expect(command[command.indexOf('-derivedDataPath') + 1]).toBe(derivedData);
      }
    });
  }

  for (const route of [
    'route_b_wda_manager_managed',
    'route_c_appium_managed',
  ] as const satisfies readonly PhysicalRoute[]) {
    test(`normalizes, installs, launches, and actively proves ${route}`, async () => {
      const { root, appPath } = createPhysicalApp();
      const resolution = resolveAppSource({
        strategy: 'user_specified',
        workspaceRoot: root,
        userAppPath: appPath,
      });
      expect(resolution.kind).toBe('user_provided');
      if (resolution.kind !== 'user_provided') return;

      const artifact = await normalizePhysicalAppArtifact({
        sourcePath: resolution.appPath,
        normalizationRoot: join(root, 'normalized'),
        expectedBundleId: 'com.example.app',
        run: validateRunner,
      });
      const calls: string[] = [];
      const permissionEngine = PermissionEngine.fromRules([]);
      const activeProbe: WdaReadinessProbe = {
        route,
        stage: 'ready',
        ready: true,
        targetDeviceUdid: 'physical-device-1',
        targetWdaBundleId: 'com.example.wda.xctrunner',
        waitedMs: 500,
      };
      const coordinator = createPhysicalPreflightCoordinator({
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
          calls.push('active-wda-probe');
          return activeProbe;
        },
        requestPermission: (callId, action, resource) =>
          permissionEngine.requestPermission(callId, action, resource),
        createCallId: () => 'phase6-preflight-call',
      });

      const result = await coordinator.run({
        artifact,
        deviceUdid: 'physical-device-1',
        route,
        confirmedTestPlan: true,
      });

      expect(result.status).toBe('ready');
      expect(calls).toEqual(['install', 'launch', 'active-wda-probe']);
    });
  }

  test('blocks an inventory-only WDA result even when the Runner is installed', async () => {
    const { root, appPath } = createPhysicalApp();
    const artifact = await normalizePhysicalAppArtifact({
      sourcePath: appPath,
      normalizationRoot: join(root, 'normalized'),
      run: validateRunner,
    });
    const coordinator = createPhysicalPreflightCoordinator({
      healthcheck: async () => ({ healthy: true }),
      isAppInstalled: async () => false,
      installApp: async () => ({ success: true }),
      launchApp: async () => ({ success: true }),
      probeWda: async () => ({
        route: 'route_b_wda_manager_managed',
        stage: 'wda_inventory',
        ready: false,
        targetDeviceUdid: 'physical-device-1',
        targetWdaBundleId: 'com.example.wda.xctrunner',
        waitedMs: 0,
        failureCode: 'wda_status_failed',
        details: 'Runner installed; no active /status evidence.',
      }),
      requestPermission: async () => ({ effect: 'allow' }),
      createCallId: () => 'phase6-inventory-call',
    });

    const result = await coordinator.run({
      artifact,
      deviceUdid: 'physical-device-1',
      route: 'route_b_wda_manager_managed',
      confirmedTestPlan: true,
    });

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.stage).toBe('wda_inventory');
    }
  });
});
