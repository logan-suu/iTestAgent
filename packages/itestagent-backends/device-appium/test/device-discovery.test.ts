import { describe, expect, it } from 'bun:test';
import {
  type DeviceDiscoveryRuntime,
  createAppiumDeviceDiscoveryProvider,
  createDeviceDiscoveryTempPath,
  discoverDeviceInventory,
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
      {
        connectionProperties: {
          transportType: 'localNetwork',
          pairingState: 'paired',
          tunnelState: 'disconnected',
        },
        hardwareProperties: { udid: 'PHONE-XCODE-26', productType: 'iPhone14,8' },
        deviceProperties: { name: 'Xcode 26 iPhone', osVersionNumber: '18.2.1' },
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
      },
      {
        udid: 'PHONE-XCODE-26',
        name: 'Xcode 26 iPhone',
        model: 'iPhone14,8',
        osVersion: '18.2.1',
        platform: 'ios',
        targetKind: 'physical',
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

  it('normalizes transitional and unknown Simulator states to schema values', () => {
    const devices = parseSimulatorDevices(
      JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
            { udid: 'SIM-STOPPING', state: 'Shutting Down', isAvailable: true },
            { udid: 'SIM-FUTURE', state: 'Restoring Snapshot', isAvailable: true },
          ],
        },
      }),
    );
    expect(devices.map((device) => device.state)).toEqual(['shutting_down', 'unknown']);
  });

  it('discovers and orders physical before simulator devices', async () => {
    const devices = await discoverDevices(undefined, createRuntime());
    expect(devices.map((device) => device.udid)).toEqual(['PHONE-1', 'PHONE-XCODE-26', 'SIM-1']);
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

  it('returns partial discovery with an explicit lane issue', async () => {
    const runtime = createRuntime();
    runtime.run = async (command) =>
      command.includes('devicectl')
        ? { stdout: '', stderr: 'xcrun failed', exitCode: 1 }
        : { stdout: simulatorFixture, stderr: '', exitCode: 0 };
    const inventory = await discoverDeviceInventory(undefined, runtime);
    expect(inventory.status).toBe('partial');
    expect(inventory.devices.map((device) => device.udid)).toEqual(['SIM-1']);
    expect(inventory.issues).toEqual([
      expect.objectContaining({ lane: 'physical', code: 'command_failed' }),
    ]);
    await expect(discoverDevices(undefined, runtime)).rejects.toThrow('Device discovery partial');
  });

  it('redacts and bounds command diagnostics exposed through the provider', async () => {
    const runtime = createRuntime();
    runtime.run = async (command) =>
      command.includes('devicectl')
        ? {
            stdout: '',
            stderr: `token=super-secret ${'x'.repeat(3_000)}`,
            exitCode: 1,
          }
        : { stdout: simulatorFixture, stderr: '', exitCode: 0 };
    const inventory = await createAppiumDeviceDiscoveryProvider(runtime).discover();
    expect(inventory.issues[0]?.message).not.toContain('super-secret');
    expect(inventory.issues[0]?.message.length).toBeLessThanOrEqual(2_020);
    expect(inventory.issues[0]?.truncated).toBe(true);
  });

  it('runs only the requested discovery lane', async () => {
    const commands: string[][] = [];
    const runtime = createRuntime();
    const originalRun = runtime.run;
    runtime.run = async (command, signal) => {
      commands.push([...command]);
      return originalRun(command, signal);
    };

    const inventory = await createAppiumDeviceDiscoveryProvider(runtime).discover({
      lanes: ['simulator'],
    });
    expect(inventory.devices.map((device) => device.udid)).toEqual(['SIM-1']);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('simctl');
  });

  it('creates collision-resistant output paths', () => {
    expect(createDeviceDiscoveryTempPath()).not.toBe(createDeviceDiscoveryTempPath());
  });
});
