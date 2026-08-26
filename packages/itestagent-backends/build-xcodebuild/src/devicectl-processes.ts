/**
 * devicectl 506.6 output parser — B12 module split (promotion guide §11.3,
 * §5.1 evidence lines L3/L4: "JSON alias、严格 text fallback、fail-closed";
 * 已有 focused regression tests).
 *
 * The CoreDevice CLI changed output shapes across versions — the `506.6`
 * era nests fields under deviceProperties/hardwareProperties/
 * connectionProperties buckets while older shapes stay flat. Parsing is
 * alias-driven with a strict fail-closed contract: unparseable JSON and
 * unrecognized document shapes surface as typed errors instead of guessed
 * values (R5).
 */
import {
  DevicectlParseError,
  parseStrictJsonObject,
  resolveFieldPath,
} from './devicectl-output.js';

// Re-exported so diagnostics consumers need only this module.
export { DevicectlParseError };

/**
 * Nested field aliases per logical field; the FIRST path that yields a
 * non-empty value wins (506.6 nested buckets before legacy flat keys).
 */
export const DEVICECTL_DEVICE_ALIASES = {
  udid: ['deviceProperties.udid', 'hardwareProperties.udid', 'udid'],
  name: ['deviceProperties.name', 'name'],
  marketingName: ['hardwareProperties.marketingName', 'marketingName'],
  osVersion: ['hardwareProperties.osVersionNumber', 'osVersion'],
  tunnelState: ['connectionProperties.tunnelState', 'tunnelState'],
} as const;

const DEVICECTL_PROCESS_ALIASES = {
  pid: ['processProperties.processIdentifier', 'processIdentifier', 'pid'],
  name: ['processProperties.executableName', 'executableName', 'name'],
  bundleId: ['processProperties.bundleIdentifier', 'bundleIdentifier', 'bundleId'],
} as const;

export interface DevicectlDeviceEntry {
  udid: string;
  name: string;
  marketingName?: string;
  osVersion?: string;
  tunnelState?: string;
}

export interface DevicectlProcessEntry {
  pid: number;
  name: string;
  bundleId?: string;
}

function firstAliasValue(entry: Record<string, unknown>, paths: readonly string[]): unknown {
  for (const path of paths) {
    const value = resolveFieldPath(entry, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * Parses `xcrun devicectl list devices` output (JSON mode).
 * Throws {@link DevicectlParseError} on unparseable bytes or an unknown
 * document shape (no devices array at any known alias path).
 */
export function parseDevicectlListDevices(raw: string): DevicectlDeviceEntry[] {
  const doc = parseStrictJsonObject(raw);
  const devices = resolveFieldPath(doc, 'result.devices') ?? resolveFieldPath(doc, 'devices');
  if (!Array.isArray(devices)) {
    throw new DevicectlParseError(
      'unknown_shape',
      'no devices array found in devicectl list-devices output',
    );
  }

  const entries: DevicectlDeviceEntry[] = [];
  for (const entry of devices as Record<string, unknown>[]) {
    const udid = firstAliasValue(entry, DEVICECTL_DEVICE_ALIASES.udid);
    const name = firstAliasValue(entry, DEVICECTL_DEVICE_ALIASES.name);
    if (typeof udid !== 'string' || typeof name !== 'string') {
      throw new DevicectlParseError(
        'unknown_shape',
        'device entry missing required udid/name under known aliases',
      );
    }
    const marketingName = firstAliasValue(entry, DEVICECTL_DEVICE_ALIASES.marketingName);
    const osVersion = firstAliasValue(entry, DEVICECTL_DEVICE_ALIASES.osVersion);
    const tunnelState = firstAliasValue(entry, DEVICECTL_DEVICE_ALIASES.tunnelState);
    entries.push({
      udid,
      name,
      marketingName: typeof marketingName === 'string' ? marketingName : undefined,
      osVersion: typeof osVersion === 'string' ? osVersion : undefined,
      tunnelState: typeof tunnelState === 'string' ? tunnelState : undefined,
    });
  }
  return entries;
}

/**
 * Parses `xcrun devicectl device info processes` output (JSON mode).
 * Rows without a usable pid are dropped rather than guessed (R5).
 */
export function parseDevicectlProcesses(raw: string): DevicectlProcessEntry[] {
  const doc = parseStrictJsonObject(raw);
  const processes = resolveFieldPath(doc, 'result.processes') ?? resolveFieldPath(doc, 'processes');
  if (!Array.isArray(processes)) {
    throw new DevicectlParseError(
      'unknown_shape',
      'no processes array found in devicectl processes output',
    );
  }

  const entries: DevicectlProcessEntry[] = [];
  for (const entry of processes as Record<string, unknown>[]) {
    const pidRaw = firstAliasValue(entry, DEVICECTL_PROCESS_ALIASES.pid);
    const pid =
      typeof pidRaw === 'number'
        ? pidRaw
        : typeof pidRaw === 'string'
          ? Number.parseInt(pidRaw, 10)
          : Number.NaN;
    if (!Number.isFinite(pid)) continue;

    const name = firstAliasValue(entry, DEVICECTL_PROCESS_ALIASES.name);
    if (typeof name !== 'string' || name.length === 0) continue;

    const bundleId = firstAliasValue(entry, DEVICECTL_PROCESS_ALIASES.bundleId);
    entries.push({
      pid,
      name,
      bundleId: typeof bundleId === 'string' ? bundleId : undefined,
    });
  }
  return entries;
}

/**
 * Strict text-fallback parsing of `devicectl ... details` output when the
 * installed CLI predates JSON modes. Section headers ("Device:") scope the
 * following "Key: value" pairs into dotted flat keys ("Device.Name").
 *
 * Comment lines (`#`) are ignored; completely empty output fails closed.
 */
export function parseDevicectlDetailsText(text: string): Record<string, string> {
  if (text.trim().length === 0) {
    throw new DevicectlParseError('unknown_shape', 'devicectl text output is empty');
  }
  const result: Record<string, string> = {};
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (line.endsWith(':')) {
      section = line.slice(0, -1).trim();
      continue;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key.length === 0) continue;
    result[section ? `${section}.${key}` : key] = value;
  }
  return result;
}
