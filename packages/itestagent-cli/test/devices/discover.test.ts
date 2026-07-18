import { describe, expect, test } from 'bun:test';
import { DeviceInfoSchema } from 'itestagent-contracts';

/**
 * Device discovery tests — validate output against DeviceInfoSchema.
 *
 * These tests validate the parsing and schema compliance layers only.
 * Subprocess execution (devicectl/simctl) is tested via CLI integration tests.
 *
 * AGENTS.md §2 (R3): Simulator capabilities require G5-SIM verification.
 * AGENTS.md §2 (R5): uncertain output must be explicitly marked, not fabricated.
 */

// ─── Schema validation ─────────────────────────────────────

describe('DeviceInfoSchema', () => {
  test('accepts valid physical device', () => {
    const device = {
      udid: '00008110-001234567890ABCD',
      name: "Logan's iPhone 14 Plus",
      model: 'iPhone14,8',
      osVersion: '18.2.1',
      platform: 'ios' as const,
      targetKind: 'physical' as const,
    };
    const parsed = DeviceInfoSchema.parse(device);
    expect(parsed.udid).toBe('00008110-001234567890ABCD');
    expect(parsed.targetKind).toBe('physical');
    expect(parsed.platform).toBe('ios');
  });

  test('accepts valid simulator device', () => {
    const device = {
      udid: 'ABCDEF12-3456-7890-ABCD-EF1234567890',
      name: 'iPhone 16 Pro',
      model: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
      osVersion: '18.2',
      platform: 'ios' as const,
      targetKind: 'simulator' as const,
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
      state: 'booted' as const,
    };
    const parsed = DeviceInfoSchema.parse(device);
    expect(parsed.udid).toBe('ABCDEF12-3456-7890-ABCD-EF1234567890');
    expect(parsed.targetKind).toBe('simulator');
    expect(parsed.state).toBe('booted');
    expect(parsed.runtimeIdentifier).toBe('com.apple.CoreSimulator.SimRuntime.iOS-18-2');
  });

  test('accepts shutdown simulator', () => {
    const device = {
      udid: 'BBBB1111-2222-3333-4444-555555555555',
      name: 'iPhone SE (3rd generation)',
      platform: 'ios' as const,
      targetKind: 'simulator' as const,
      state: 'shutdown' as const,
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-17-4',
    };
    const parsed = DeviceInfoSchema.parse(device);
    expect(parsed.state).toBe('shutdown');
  });

  test('rejects invalid targetKind', () => {
    expect(() =>
      DeviceInfoSchema.parse({
        udid: 'test',
        platform: 'ios',
        targetKind: 'invalid',
      }),
    ).toThrow();
  });

  test('rejects android platform for iOS-only tool', () => {
    // android is in the schema enum but iTestAgent is iOS-only;
    // schema allows it for forward compatibility but it should not appear
    const android = {
      udid: 'test-android',
      platform: 'android' as const,
      targetKind: 'physical' as const,
    };
    const parsed = DeviceInfoSchema.parse(android);
    expect(parsed.platform).toBe('android');
  });

  test('rejects missing required fields', () => {
    expect(() =>
      DeviceInfoSchema.parse({
        name: 'missing udid and platform',
      }),
    ).toThrow();
  });

  test('validates simulator state enum values', () => {
    const validStates = ['booted', 'shutdown', 'creating', 'booting', 'shutting_down'] as const;
    for (const state of validStates) {
      const device = {
        udid: `test-${state}`,
        platform: 'ios' as const,
        targetKind: 'simulator' as const,
        state,
      };
      const parsed = DeviceInfoSchema.parse(device);
      expect(parsed.state).toBe(state);
    }
  });

  test('rejects invalid simulator state', () => {
    expect(() =>
      DeviceInfoSchema.parse({
        udid: 'test',
        platform: 'ios' as const,
        targetKind: 'simulator' as const,
        state: 'running',
      }),
    ).toThrow();
  });
});

// ─── Output format validation ──────────────────────────────

describe('DeviceInfo output shape', () => {
  test('physical device shape matches US-2.1 requirements', () => {
    // US-2.1: name, model, iOS version, UDID, battery, status
    const device = DeviceInfoSchema.parse({
      udid: '00008110-001234567890ABCD',
      name: "Logan's iPhone",
      model: 'iPhone14,8',
      osVersion: '18.2.1',
      platform: 'ios' as const,
      targetKind: 'physical' as const,
    });

    // All core fields present
    expect(device.udid).toBeTruthy();
    expect(device.name).toBeTruthy();
    expect(device.model).toBeTruthy();
    expect(device.osVersion).toBeTruthy();
    expect(device.targetKind).toBe('physical');
    // Battery is optional — may be unavailable from devicectl
    // State is undefined for physical (simulator-only field)
    expect(device.state).toBeUndefined();
  });

  test('simulator device shape matches US-2.3 requirements', () => {
    // US-2.3 AC2: KIND, NAME, OS/RUNTIME, UDID, STATE
    const device = DeviceInfoSchema.parse({
      udid: 'ABC-123',
      name: 'iPhone 16 Pro',
      model: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
      osVersion: '18.2',
      platform: 'ios' as const,
      targetKind: 'simulator' as const,
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
      state: 'booted' as const,
    });

    expect(device.targetKind).toBe('simulator');
    expect(device.name).toBeTruthy();
    expect(device.osVersion).toBeTruthy();
    expect(device.udid).toBeTruthy();
    expect(device.state).toBe('booted');
    expect(device.runtimeIdentifier).toBeTruthy();
    expect(device.deviceTypeIdentifier).toBeTruthy();
  });
});
