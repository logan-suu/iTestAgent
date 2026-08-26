/**
 * devicectl-processes.test.ts — B12 devicectl 506.6 parser regression and
 * fail-closed coverage (promotion guide §5.1 "JSON alias、严格 text
 * fallback、fail-closed"; L3/L4 evidence lines).
 *
 * The CoreDevice CLI changed output shapes across versions; the parser must
 * resolve known field aliases, fall back strictly to the text format, and
 * FAIL CLOSED on unknown shapes instead of guessing (R5).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEVICECTL_DEVICE_ALIASES,
  DevicectlParseError,
  parseDevicectlDetailsText,
  parseDevicectlListDevices,
  parseDevicectlProcesses,
} from '../src/devicectl-processes.js';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const FIXTURES = join(REPO_ROOT, 'fixtures', 'device-responses');

describe('parseDevicectlListDevices (506.6 aliases)', () => {
  it('parses the sanitized 506.6 fixture via nested field aliases', () => {
    const raw = readFileSync(join(FIXTURES, 'devicectl-list-devices-sanitized.json'), 'utf-8');
    const devices = parseDevicectlListDevices(raw);
    expect(devices).toHaveLength(2);
    const first = devices[0];
    if (!first) throw new Error('expected at least one device entry');
    expect(first.udid).toBe('UDID-FIXTURE-00000000000000000001');
    expect(first.name).toBe('FIXTURE-PHONE-01');
    expect(first.marketingName).toBe('iPhone Fixture Pro');
    expect(first.osVersion).toBe('18.2');
    expect(first.tunnelState).toBe('connected');
  });

  it('falls back to flat alias shapes when nested paths are absent', () => {
    const flat = JSON.stringify({
      devices: [{ udid: 'UDID-FIXTURE-FLAT', name: 'Flat Fixture' }],
    });
    const devices = parseDevicectlListDevices(flat);
    expect(devices[0]?.udid).toBe('UDID-FIXTURE-FLAT');
  });

  it('exposes the alias table for diagnostics', () => {
    expect(DEVICECTL_DEVICE_ALIASES.udid).toContain('deviceProperties.udid');
  });
});

describe('devicectl parsing fails closed (R5)', () => {
  it('rejects non-JSON output with a typed unparseable_json error', () => {
    try {
      parseDevicectlListDevices('{ not json');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DevicectlParseError);
      expect((error as DevicectlParseError).code).toBe('unparseable_json');
    }
  });

  it('rejects unknown document shapes with unknown_shape', () => {
    try {
      parseDevicectlListDevices('{"foo": 1}');
      throw new Error('expected throw');
    } catch (error) {
      expect((error as DevicectlParseError).code).toBe('unknown_shape');
    }
  });
});

describe('parseDevicectlProcesses', () => {
  it('parses process entries through aliases and drops pid-less rows', () => {
    const raw = JSON.stringify({
      result: {
        processes: [
          {
            processProperties: {
              processIdentifier: 42,
              executableName: 'FixtureApp',
              bundleIdentifier: 'com.example.fixture',
            },
          },
          { processProperties: { executableName: 'NoPid' } },
        ],
      },
    });
    const entries = parseDevicectlProcesses(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.pid).toBe(42);
    expect(entries[0]?.name).toBe('FixtureApp');
    expect(entries[0]?.bundleId).toBe('com.example.fixture');
  });

  it('fails closed on unparseable process output', () => {
    expect(() => parseDevicectlProcesses('garbage')).toThrow(DevicectlParseError);
  });
});

describe('parseDevicectlDetailsText (strict text fallback)', () => {
  it('parses the sanitized text fixture into sectioned keys', () => {
    const raw = readFileSync(join(FIXTURES, 'devicectl-details-sanitized.txt'), 'utf-8');
    const details = parseDevicectlDetailsText(raw);
    expect(details['Device.Name']).toBe('FIXTURE-PHONE-01');
    expect(details['Device.UDID']).toBe('UDID-FIXTURE-00000000000000000001');
    expect(details['Hardware.MarketingName']).toBe('iPhone Fixture Pro');
    expect(details['Connection.TunnelState']).toBe('connected');
  });

  it('ignores comment lines but keeps strictness for empty input', () => {
    expect(parseDevicectlDetailsText('# just a comment')).toEqual({});
    expect(() => parseDevicectlDetailsText('')).toThrow(DevicectlParseError);
  });
});
