import { describe, expect, test } from 'bun:test';
import type { DeviceInfo, HealthCheckResult } from 'itestagent-contracts';
import {
  formatDeviceList,
  formatHealthcheckResult,
  formatHealthcheckResults,
  formatNoDevices,
} from '../../src/devices/format.js';

/**
 * Formatter tests — validate terminal output format correctness.
 *
 * US-2.1 AC2: no devices → clear prompt with connection guidance
 * US-2.3 AC2: each device shows KIND, NAME, OS/RUNTIME, UDID, STATE
 */

// ─── No devices ────────────────────────────────────────────

describe('formatNoDevices', () => {
  test('returns non-empty guidance string', () => {
    const output = formatNoDevices();
    expect(output).toBeTruthy();
    expect(output.length).toBeGreaterThan(50);
  });

  test('includes physical connection guidance', () => {
    const output = formatNoDevices();
    expect(output).toContain('USB');
    expect(output).toContain('Trust');
  });

  test('includes simulator setup guidance', () => {
    const output = formatNoDevices();
    expect(output).toContain('Simulator');
    expect(output).toContain('simctl');
  });

  test('references doctor command for full diagnostics', () => {
    const output = formatNoDevices();
    expect(output).toContain('doctor');
  });
});

// ─── Device list formatting ────────────────────────────────

function makePhysicalDevice(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    udid: '00008110-001234567890ABCD',
    name: "Logan's iPhone 14 Plus",
    model: 'iPhone14,8',
    osVersion: '18.2.1',
    platform: 'ios',
    targetKind: 'physical',
    ...overrides,
  };
}

function makeSimulatorDevice(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    udid: 'ABCDEF12-3456-7890-ABCD-EF1234567890',
    name: 'iPhone 16 Pro',
    model: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
    osVersion: '18.2',
    platform: 'ios',
    targetKind: 'simulator',
    runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
    state: 'booted',
    ...overrides,
  };
}

describe('formatDeviceList', () => {
  test('empty array returns no-devices guidance', () => {
    const output = formatDeviceList([]);
    expect(output).toContain('No devices found');
  });

  test('single physical device shows all required fields (US-2.3 AC2)', () => {
    const device = makePhysicalDevice();
    const output = formatDeviceList([device]);

    // KIND
    expect(output).toContain('physical');
    // NAME
    expect(output).toContain("Logan's iPhone 14 Plus");
    // OS
    expect(output).toContain('18.2.1');
    // UDID
    expect(output).toContain('00008110-001234567890ABCD');
    // Summary
    expect(output).toContain('1 physical');
  });

  test('single simulator device shows all required fields (US-2.3 AC2)', () => {
    const device = makeSimulatorDevice();
    const output = formatDeviceList([device]);

    // KIND
    expect(output).toContain('simulator');
    // NAME
    expect(output).toContain('iPhone 16 Pro');
    // OS
    expect(output).toContain('18.2');
    // UDID
    expect(output).toContain('ABCDEF12');
    // STATE
    expect(output).toContain('booted');
    // Summary
    expect(output).toContain('1 simulator');
  });

  test('mixed physical + simulator has both counts in summary', () => {
    const physical = makePhysicalDevice();
    const sim = makeSimulatorDevice();
    const output = formatDeviceList([physical, sim]);

    expect(output).toContain('physical');
    expect(output).toContain('simulator');
    expect(output).toContain('Total: 2');
    expect(output).toContain('1 physical');
    expect(output).toContain('1 simulator');
  });

  test('physical and simulator devices are both shown', () => {
    const physical = makePhysicalDevice();
    const sim = makeSimulatorDevice();
    // formatDeviceList preserves input order; discoverAllDevices sorts
    const output = formatDeviceList([physical, sim]);

    expect(output).toContain('physical');
    expect(output).toContain('simulator');
    expect(output).toContain('Total: 2');
    expect(output).toContain('1 physical');
    expect(output).toContain('1 simulator');
  });

  test('shutdown simulator shows correct state', () => {
    const device = makeSimulatorDevice({ state: 'shutdown' });
    const output = formatDeviceList([device]);
    expect(output).toContain('shutdown');
  });

  test('device with missing name shows Unknown', () => {
    const device = makePhysicalDevice({ name: undefined });
    const output = formatDeviceList([device]);
    expect(output).toContain('Unknown');
  });

  test('device with missing osVersion shows N/A', () => {
    const device = makePhysicalDevice({ osVersion: undefined });
    const output = formatDeviceList([device]);
    expect(output).toContain('N/A');
  });
});

// ─── Healthcheck formatting ───────────────────────────────

describe('formatHealthcheckResult', () => {
  test('healthy result shows PASS', () => {
    const result: HealthCheckResult = { healthy: true, details: 'All good' };
    const output = formatHealthcheckResult('udid-1', 'Test Device', result);
    expect(output).toContain('PASS');
    expect(output).toContain('Test Device');
    expect(output).toContain('udid-1');
  });

  test('unhealthy result shows FAIL', () => {
    const result: HealthCheckResult = { healthy: false, details: 'Not trusted' };
    const output = formatHealthcheckResult('udid-2', 'Bad Device', result);
    expect(output).toContain('FAIL');
    expect(output).toContain('Bad Device');
  });
});

describe('formatHealthcheckResults', () => {
  test('shows pass/fail summary counts', () => {
    const results = new Map<string, HealthCheckResult>();
    results.set('udid-1', { healthy: true, details: 'OK' });
    results.set('udid-2', { healthy: false, details: 'Fail' });
    results.set('udid-3', { healthy: true, details: 'OK' });

    const devices: DeviceInfo[] = [
      makePhysicalDevice({ udid: 'udid-1', name: 'Device 1' }),
      makeSimulatorDevice({ udid: 'udid-2', name: 'Device 2' }),
      makeSimulatorDevice({ udid: 'udid-3', name: 'Device 3' }),
    ];

    const output = formatHealthcheckResults(results, devices);

    expect(output).toContain('2 passed');
    expect(output).toContain('1 failed');
    expect(output).toContain('Device 1');
    expect(output).toContain('Device 2');
    expect(output).toContain('Device 3');
  });

  test('handles missing healthcheck result gracefully', () => {
    const results = new Map<string, HealthCheckResult>();
    results.set('udid-1', { healthy: true });

    const devices: DeviceInfo[] = [
      makePhysicalDevice({ udid: 'udid-1', name: 'Device 1' }),
      makeSimulatorDevice({ udid: 'missing-udid', name: 'Missing' }),
    ];

    const output = formatHealthcheckResults(results, devices);
    // Should not mention 'Missing' device (no result for it)
    expect(output).toContain('Device 1');
    expect(output).not.toContain('Missing');
  });
});
