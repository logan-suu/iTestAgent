/**
 * Physical device discovery parser — B18 module split (promotion guide §11.3
 * "physical discovery/doctor"; §5.1 "JSON alias、严格 text fallback、
 * fail-closed"; §6.2 "real-device fixtures — 新脱敏内容，不复制原 bytes").
 *
 * Turns the devicectl CLI's nested 506.6-shaped output into flat physical
 * device entries, keeping only connected devices and failing closed on
 * unparseable output (R5). Aliases walk the nested buckets first and fall
 * back to flat keys.
 */
import { PhysicalDiscoveryError } from './physical-discovery-error.js';

export interface PhysicalDeviceEntry {
  udid: string;
  name: string;
  model?: string;
  osVersion?: string;
  tunnelState?: string;
}

type JsonRecord = Record<string, unknown>;

function stringField(record: JsonRecord | undefined, paths: string[]): string | undefined {
  if (!record) return undefined;
  for (const path of paths) {
    const value = record[path];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Parses devicectl output into connected physical-device entries.
 * Unavailable devices are dropped; unparseable bytes throw
 * {@link PhysicalDiscoveryError} (fail-closed).
 */
export function parsePhysicalDiscoveryOutput(raw: string): PhysicalDeviceEntry[] {
  let doc: unknown;
  try {
    doc = JSON.parse(raw) as unknown;
  } catch {
    throw new PhysicalDiscoveryError('unparseable_output', 'devicectl output is not valid JSON');
  }

  const root = doc as JsonRecord;
  const result = root.result as JsonRecord | undefined;
  const devices = result?.devices ?? root.devices;
  if (!Array.isArray(devices)) return [];

  const entries: PhysicalDeviceEntry[] = [];
  for (const device of devices as JsonRecord[]) {
    const props = device.deviceProperties as JsonRecord | undefined;
    const hw = device.hardwareProperties as JsonRecord | undefined;
    const conn = device.connectionProperties as JsonRecord | undefined;

    const udid =
      stringField(props, ['udid']) ?? stringField(hw, ['udid']) ?? stringField(device, ['udid']);
    const name = stringField(props, ['name']) ?? stringField(device, ['name']);
    if (!udid || !name) continue;

    const tunnelState =
      stringField(conn, ['tunnelState']) ??
      stringField(device, ['tunnelState']) ??
      stringField(device, ['state']);
    if (tunnelState?.toLowerCase() === 'unavailable') continue; // keep connected only

    const entry: PhysicalDeviceEntry = { udid, name };
    const model = stringField(hw, ['marketingName']);
    const osVersion = stringField(hw, ['osVersionNumber']);
    if (model) entry.model = model;
    if (osVersion) entry.osVersion = osVersion;
    if (tunnelState) entry.tunnelState = tunnelState;
    entries.push(entry);
  }
  return entries;
}
