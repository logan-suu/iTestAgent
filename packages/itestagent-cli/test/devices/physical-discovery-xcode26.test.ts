/**
 * physical-discovery-xcode26.test.ts — B18 physical device discovery parser
 * coverage (promotion guide §11.3 "physical discovery/doctor"; §5.1 "JSON
 * alias、严格 text fallback、fail-closed"; §6.2 "real-device fixtures —
 * 新脱敏内容，不复制原 bytes").
 *
 * Locks the devicectl 506.6-shaped parser that turns the CLI's nested device
 * output into flat physical-device entries, keeping only connected devices
 * and failing closed on unparseable output.
 */
import { describe, expect, it } from 'bun:test';
import { PhysicalDiscoveryError } from '../../src/devices/physical-discovery-error.js';
import { parsePhysicalDiscoveryOutput } from '../../src/devices/physical-discovery-parser.js';

const SAMPLE_506_6 = JSON.stringify({
  result: {
    devices: [
      {
        deviceProperties: {
          name: 'FIXTURE-PHONE',
          udid: 'UDID-FIXTURE-00000000000000000001',
        },
        hardwareProperties: {
          marketingName: 'iPhone Fixture Pro',
          osVersionNumber: '18.2',
        },
        connectionProperties: {
          tunnelState: 'connected',
          pairingState: 'paired',
        },
      },
      {
        deviceProperties: {
          name: 'FIXTURE-PAD',
          udid: 'UDID-FIXTURE-00000000000000000002',
        },
        hardwareProperties: {
          marketingName: 'iPad Fixture Air',
          osVersionNumber: '18.2',
        },
        connectionProperties: {
          tunnelState: 'unavailable',
          pairingState: 'paired',
        },
      },
    ],
  },
});

describe('parsePhysicalDiscoveryOutput', () => {
  it('parses 506.6 nested device entries into flat physical devices', () => {
    const devices = parsePhysicalDiscoveryOutput(SAMPLE_506_6);
    expect(devices).toHaveLength(1); // only the connected device survives
    const first = devices[0];
    if (!first) throw new Error('expected one connected device');
    expect(first.udid).toBe('UDID-FIXTURE-00000000000000000001');
    expect(first.name).toBe('FIXTURE-PHONE');
    expect(first.model).toBe('iPhone Fixture Pro');
    expect(first.osVersion).toBe('18.2');
    expect(first.tunnelState).toBe('connected');
  });

  it('accepts the flat alias shape as a fallback', () => {
    const flat = JSON.stringify({
      devices: [{ udid: 'UDID-FIXTURE-FLAT', name: 'Flat Fixture', state: 'connected' }],
    });
    const devices = parsePhysicalDiscoveryOutput(flat);
    expect(devices[0]?.udid).toBe('UDID-FIXTURE-FLAT');
  });

  it('fails closed on unparseable output', () => {
    try {
      parsePhysicalDiscoveryOutput('{ not json');
      throw new Error('expected parse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PhysicalDiscoveryError);
    }
  });

  it('returns an empty list when no devices are present', () => {
    expect(parsePhysicalDiscoveryOutput('{"result":{"devices":[]}}')).toEqual([]);
  });
});
