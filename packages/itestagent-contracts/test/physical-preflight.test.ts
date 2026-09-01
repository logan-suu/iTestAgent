import { describe, expect, test } from 'bun:test';
import {
  PhysicalAppArtifactSchema,
  PhysicalPreflightResultSchema,
  WdaReadinessProbeSchema,
} from '../src/physical-preflight.js';

const artifact = PhysicalAppArtifactSchema.parse({
  sourceKind: 'ipa',
  sourcePath: '/tmp/Example.ipa',
  appPath: '/tmp/normalized/Payload/Example.app',
  bundleId: 'com.example.app',
  executable: 'Example',
  supportedPlatforms: ['iPhoneOS'],
  architectures: ['arm64'],
  signingValid: true,
});

describe('WdaReadinessProbeSchema', () => {
  test('rejects non-WDA preflight stages', () => {
    expect(() =>
      WdaReadinessProbeSchema.parse({
        route: 'route_b_wda_manager_managed',
        stage: 'install',
        ready: false,
        targetDeviceUdid: 'device-1',
        targetWdaBundleId: 'com.example.wda',
        waitedMs: 0,
        failureCode: 'wda_status_failed',
      }),
    ).toThrow();
  });

  test('accepts an active ready probe for an explicit route', () => {
    const result = WdaReadinessProbeSchema.parse({
      route: 'route_b_wda_manager_managed',
      stage: 'ready',
      ready: true,
      targetDeviceUdid: 'device-1',
      targetWdaBundleId: 'com.example.wda',
      waitedMs: 2400,
    });

    expect(result.ready).toBe(true);
  });

  test('rejects installed-only inventory evidence as ready', () => {
    expect(() =>
      WdaReadinessProbeSchema.parse({
        route: 'route_b_wda_manager_managed',
        stage: 'wda_inventory',
        ready: true,
        targetDeviceUdid: 'device-1',
        targetWdaBundleId: 'com.example.wda',
        waitedMs: 0,
      }),
    ).toThrow();
  });

  test('requires a classified failure for a blocked probe', () => {
    expect(() =>
      WdaReadinessProbeSchema.parse({
        route: 'route_c_appium_managed',
        stage: 'appium_session',
        ready: false,
        targetDeviceUdid: 'device-1',
        targetWdaBundleId: 'com.example.wda',
        waitedMs: 10_000,
      }),
    ).toThrow();
  });
});

describe('PhysicalPreflightResultSchema', () => {
  test('accepts a ready result only with validated app and active WDA evidence', () => {
    const result = PhysicalPreflightResultSchema.parse({
      status: 'ready',
      stage: 'ready',
      artifact,
      wda: {
        route: 'route_c_appium_managed',
        stage: 'ready',
        ready: true,
        targetDeviceUdid: 'device-1',
        targetWdaBundleId: 'com.example.wda',
        waitedMs: 4800,
      },
    });

    expect(result.status).toBe('ready');
  });

  test('accepts a blocked result with an explicit failure stage', () => {
    const result = PhysicalPreflightResultSchema.parse({
      status: 'blocked',
      stage: 'artifact_validation',
      failure: {
        code: 'artifact_incompatible',
        stage: 'artifact_validation',
        message: 'The application does not contain an arm64 executable.',
      },
    });

    expect(result.status).toBe('blocked');
  });

  test('rejects mismatched outer and failure stages', () => {
    expect(() =>
      PhysicalPreflightResultSchema.parse({
        status: 'blocked',
        stage: 'install',
        failure: {
          code: 'launch_failed',
          stage: 'launch',
          message: 'Launch failed.',
        },
      }),
    ).toThrow();
  });
});
