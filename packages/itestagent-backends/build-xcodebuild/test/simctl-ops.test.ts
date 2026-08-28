/**
 * simctl-ops.test.ts — B12 simulator device operations coverage (promotion
 * guide §11.3 "build-xcodebuild", §6.1 "simctl … build drivers").
 *
 * createSimctlOps wraps `xcrun simctl` with an injected process runner; this
 * suite locks the JSON flattening across runtime buckets and the exact CLI
 * argument sequences for lifecycle operations.
 */
import { describe, expect, it } from 'bun:test';
import { createSimctlOps } from '../src/simctl-ops.js';
import type {
  XcodebuildProcessResult,
  XcodebuildProcessRunner,
} from '../src/xcodebuild-process-types.js';

const SIMCTL_DEVICES_JSON = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
      {
        udid: 'SIM-FIXTURE-BOOTED',
        name: 'Fixture Sim Booted',
        state: 'Booted',
        isAvailable: true,
      },
      {
        udid: 'SIM-FIXTURE-SHUTDOWN',
        name: 'Fixture Sim Idle',
        state: 'Shutdown',
        isAvailable: true,
      },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [
      { udid: 'SIM-FIXTURE-OLD', name: 'Fixture Sim Old', state: 'Shutdown', isAvailable: false },
    ],
  },
});

function makeRecordingRunner(respond: (cmd: string, args: string[]) => XcodebuildProcessResult): {
  runner: XcodebuildProcessRunner;
  calls: Array<{ cmd: string; args: string[] }>;
} {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const runner: XcodebuildProcessRunner = async (cmd, args) => {
    calls.push({ cmd, args });
    return respond(cmd, args);
  };
  return { runner, calls };
}

describe('simctl listDevices', () => {
  it('flattens runtime-bucketed device entries from the --json payload', async () => {
    const { runner, calls } = makeRecordingRunner(() => ({
      exitCode: 0,
      stdout: SIMCTL_DEVICES_JSON,
      stderr: '',
    }));
    const ops = createSimctlOps(runner);
    const devices = await ops.listDevices();
    expect(devices).toHaveLength(3);
    expect(devices.map((d) => d.udid)).toEqual([
      'SIM-FIXTURE-BOOTED',
      'SIM-FIXTURE-SHUTDOWN',
      'SIM-FIXTURE-OLD',
    ]);
    // Pinned binary + subcommand ordering.
    expect(calls[0]?.cmd).toBe('xcrun');
    expect(calls[0]?.args).toEqual(['simctl', 'list', 'devices', '--json']);
  });

  it('fails closed when the payload is not the expected shape', async () => {
    const { runner } = makeRecordingRunner(() => ({
      exitCode: 0,
      stdout: '{"unexpected": true}',
      stderr: '',
    }));
    const ops = createSimctlOps(runner);
    expect(ops.listDevices()).rejects.toThrow();
  });
});

describe('simctl lifecycle operations', () => {
  it('isBooted reflects the device state from listDevices', async () => {
    const { runner } = makeRecordingRunner(() => ({
      exitCode: 0,
      stdout: SIMCTL_DEVICES_JSON,
      stderr: '',
    }));
    const ops = createSimctlOps(runner);
    await expect(ops.isBooted('SIM-FIXTURE-BOOTED')).resolves.toBe(true);
    await expect(ops.isBooted('SIM-FIXTURE-SHUTDOWN')).resolves.toBe(false);
  });

  it('boot and shutdown issue the exact pinned argument sequences', async () => {
    const { runner, calls } = makeRecordingRunner(() => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    }));
    const ops = createSimctlOps(runner);
    await ops.boot('SIM-FIXTURE-1');
    await ops.shutdown('SIM-FIXTURE-1');
    expect(calls[0]?.args).toEqual(['simctl', 'boot', 'SIM-FIXTURE-1']);
    expect(calls[1]?.args).toEqual(['simctl', 'shutdown', 'SIM-FIXTURE-1']);
  });

  it('surfaces non-zero exits as typed failures instead of throwing raw errors', async () => {
    const { runner } = makeRecordingRunner(() => ({
      exitCode: 149,
      stdout: '',
      stderr: 'Unable to boot device in current state',
    }));
    const ops = createSimctlOps(runner);
    await expect(ops.boot('SIM-FIXTURE-BAD')).rejects.toThrow(/149|Unable to boot/);
  });
});
