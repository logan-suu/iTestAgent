import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceBackend, DeviceInfo, PhysicalAppArtifact } from 'itestagent-contracts';
import { TestPlanSchema } from 'itestagent-contracts';
import {
  createProductionPhysicalPreflight,
  runProductionPhysicalCommand,
} from '../src/production-physical-preflight.js';

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
  for (const abortStage of ['build', '-showBuildSettings', 'validation']) {
    test(`propagates cancellation during ${abortStage} and prevents subsequent stages`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'itestagent-preflight-abort-'));
      const controller = new AbortController();
      const calls: string[] = [];
      const reason = new DOMException('Test cancellation', 'AbortError');
      const preflight = createProductionPhysicalPreflight({
        findProjectFile: () => ({ type: 'xcode_project', path: '/workspace/Demo.xcodeproj' }),
        resolveAppSource: () => ({
          kind: 'build_required',
          workspacePath: '/workspace',
          projectType: 'xcodeproj',
        }),
        normalizePhysicalAppArtifact: async ({ run }) => {
          await run('validation', []);
          return artifact;
        },
        createDevicectlOps: () => {
          calls.push('device');
          return {} as never;
        },
        runCommand: async (cmd, args, options) => {
          expect(options?.signal).toBe(controller.signal);
          const stage = cmd === 'validation' ? cmd : args[0];
          calls.push(stage as string);
          if (stage === abortStage) {
            controller.abort(reason);
            // Some process adapters return an exit code instead of throwing.
            return { exitCode: 143, stdout: '', stderr: '' };
          }
          return {
            exitCode: 0,
            stdout: `TARGET_BUILD_DIR = ${root}\nFULL_PRODUCT_NAME = Demo.app`,
            stderr: '',
          };
        },
      });
      try {
        await expect(
          preflight({
            plan,
            workspace: '/workspace',
            scheme: 'Demo',
            device,
            bundleId: artifact.bundleId,
            stagingDir: root,
            backend: {} as DeviceBackend,
            authorize: async () => true,
            signal: controller.signal,
          }),
        ).rejects.toBe(reason);
        expect(calls).toEqual(
          ['build', '-showBuildSettings', 'validation'].slice(
            0,
            ['build', '-showBuildSettings', 'validation'].indexOf(abortStage) + 1,
          ),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test('reaps an owned child that ignores SIGTERM before reporting cancellation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'itestagent-preflight-child-'));
    const marker = join(root, 'ready');
    const controller = new AbortController();
    const reason = new DOMException('Test cancellation', 'AbortError');
    const running = runProductionPhysicalCommand(
      process.execPath,
      [
        '-e',
        `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000);`,
      ],
      { cwd: root, signal: controller.signal },
    );
    // Attach a handler before cancellation so the test itself never leaks a rejection.
    const settled = running.then(
      () => null,
      (error: unknown) => error,
    );
    let pid: number | undefined;
    try {
      const deadline = Date.now() + 3_000;
      while (!existsSync(marker) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(existsSync(marker)).toBe(true);
      pid = Number(readFileSync(marker, 'utf8'));
      controller.abort(reason);
      expect(await settled).toBe(reason);
      expect(() => process.kill(pid as number, 0)).toThrow();
    } finally {
      controller.abort(reason);
      if (pid !== undefined) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      await settled;
      rmSync(root, { recursive: true, force: true });
    }
  });

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
