import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizePhysicalAppArtifact,
  resolveAppSource,
} from 'itestagent-backends-build-xcodebuild';
import type { XcodebuildProcessRunner } from 'itestagent-backends-build-xcodebuild';
import type { PhysicalRoute, WdaReadinessProbe } from 'itestagent-contracts';
import { PermissionEngine, createPhysicalPreflightCoordinator } from 'itestagent-engine';

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
