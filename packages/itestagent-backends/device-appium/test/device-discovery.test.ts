import { describe, expect, it } from 'bun:test';
import {
  type DeviceDiscoveryRuntime,
  discoverDevices,
  discoverPhysicalDevices,
  parsePhysicalDevices,
  parseSimulatorDevices,
} from '../src/device-discovery.js';

const physicalFixture = {
  result: {
    devices: [
      {
        connectionProperties: { transportType: 'wired', pairingState: 'paired' },
        hardwareProperties: { udid: 'PHONE-1', productType: 'iPhone14,8' },
        deviceProperties: { name: 'Test iPhone', osVersionNumber: '18.2.1' },
      },
      {
        connectionProperties: { transportType: 'wireless', pairingState: 'unpaired' },
        hardwareProperties: { udid: 'IGNORED' },
      },
    ],
  },
};

const simulatorFixture = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
      {
        udid: 'SIM-1',
        name: 'iPhone 16 Pro',
        state: 'Booted',
        isAvailable: true,
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
      },
      { udid: 'SIM-OLD', name: 'Unavailable', state: 'Shutdown', isAvailable: false },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
      { udid: 'WATCH-1', name: 'Apple Watch', state: 'Booted', isAvailable: true },
    ],
  },
});

function createRuntime(): DeviceDiscoveryRuntime {
  return {
    async run(command) {
      if (command.includes('devicectl')) return { stdout: '', stderr: '', exitCode: 0 };
      return { stdout: simulatorFixture, stderr: '', exitCode: 0 };
    },
    createTempJsonPath: () => '/tmp/itestagent-device-fixture.json',
    exists: () => true,
    readText: () => JSON.stringify(physicalFixture),
    remove: () => {},
  };
}

describe('shared Appium device discovery', () => {
  it('normalizes paired physical devices and rejects unavailable entries', () => {
    expect(parsePhysicalDevices(physicalFixture)).toEqual([
      {
        udid: 'PHONE-1',
        name: 'Test iPhone',
        model: 'iPhone14,8',
        osVersion: '18.2.1',
        platform: 'ios',
        targetKind: 'physical',
        state: 'booted',
      },
    ]);
  });

  it('normalizes available iOS simulators only', () => {
    const devices = parseSimulatorDevices(simulatorFixture);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      udid: 'SIM-1',
      targetKind: 'simulator',
      osVersion: '18.2',
      state: 'booted',
    });
  });

  it('discovers and orders physical before simulator devices', async () => {
    const devices = await discoverDevices(undefined, createRuntime());
    expect(devices.map((device) => device.udid)).toEqual(['PHONE-1', 'SIM-1']);
  });

  it('removes the devicectl JSON output after discovery', async () => {
    let removed = false;
    const runtime = createRuntime();
    runtime.remove = () => {
      removed = true;
    };
    await discoverPhysicalDevices(undefined, runtime);
    expect(removed).toBe(true);
  });

  it('fails closed to an empty list when the command fails', async () => {
    const runtime = createRuntime();
    runtime.run = async () => ({ stdout: '', stderr: 'xcrun failed', exitCode: 1 });
    expect(await discoverDevices(undefined, runtime)).toEqual([]);
  });
});
