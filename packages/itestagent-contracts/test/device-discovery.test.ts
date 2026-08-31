import { describe, expect, it } from 'bun:test';
import { type DeviceDiscoveryProvider, DeviceDiscoverySnapshotSchema } from '../src/index.js';

describe('DeviceDiscoveryProvider contract', () => {
  it('parses explicit partial discovery with an unknown Simulator state', () => {
    const snapshot = DeviceDiscoverySnapshotSchema.parse({
      devices: [{ udid: 'sim-1', platform: 'ios', targetKind: 'simulator', state: 'unknown' }],
      status: 'partial',
      issues: [{ lane: 'physical', code: 'command_failed', message: 'devicectl unavailable' }],
    });
    expect(snapshot.status).toBe('partial');
    expect(snapshot.devices[0]?.state).toBe('unknown');
  });

  it('supports an injectable pre-selection provider', async () => {
    let requestedLanes: readonly string[] | undefined;
    const provider: DeviceDiscoveryProvider = {
      discover: async (options) => {
        requestedLanes = options?.lanes;
        return { devices: [], status: 'ok', issues: [] };
      },
    };
    expect((await provider.discover({ lanes: ['simulator'] })).status).toBe('ok');
    expect(requestedLanes).toEqual(['simulator']);
  });

  it('rejects ok snapshots that contain discovery issues', () => {
    expect(() =>
      DeviceDiscoverySnapshotSchema.parse({
        devices: [],
        status: 'ok',
        issues: [{ lane: 'physical', code: 'command_failed', message: 'unavailable' }],
      }),
    ).toThrow();
  });

  it('rejects non-ok snapshots that contain no discovery issues', () => {
    for (const status of ['partial', 'failed'] as const) {
      expect(() =>
        DeviceDiscoverySnapshotSchema.parse({ devices: [], status, issues: [] }),
      ).toThrow();
    }
  });
});
