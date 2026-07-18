/**
 * Device discovery — list physical (devicectl) and Simulator (simctl) devices.
 *
 * US-2.1 AC3: data source xcrun devicectl list devices
 * US-2.3 AC1: list both physical (devicectl) and Simulator (simctl list --json)
 *
 * Phase 0 §4.7: cross-check devicectl with xcdevice for physical device availability.
 * 避坑手册 §3: devicectl behavior varies across Xcode versions; defensive parsing required.
 *
 * AGENTS.md §2 (R2): reuse xcrun, no self-built device interaction.
 */

import { DeviceInfoSchema } from 'itestagent-contracts';
import type { DeviceInfo } from 'itestagent-contracts';

// ─── Subprocess helpers ─────────────────────────────────────

function exec(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const result = Bun.spawnSync({ cmd: args });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  } catch {
    return { exitCode: -1, stdout: '', stderr: 'command not found' };
  }
}

// ─── Physical device discovery ──────────────────────────────

/**
 * Device state mapping from devicectl output to US-2.1 AC1 states.
 * devicectl does not expose a clean state enum — we infer from output patterns.
 */
type PhysicalDeviceState = 'healthy' | 'untrusted' | 'busy' | 'developer_mode_off';

interface RawPhysicalDevice {
  udid: string;
  name?: string;
  model?: string;
  osVersion?: string;
  state: PhysicalDeviceState;
  battery?: number;
}

/**
 * Parse `xcrun devicectl list devices` output.
 *
 * devicectl output (Xcode 26+):
 *   Name          Hostname                       Identifier                              State               Model
 *   ----          --------                       ----------                              -----               -----
 *   Logan's phone Logans-phone.coredevice.local  F7C1CF80-8A2C-5AFB-85FE-C959DC4EC1F9  available (paired)  iPhone 14 Plus (iPhone14,8)
 *
 * Format is columnar. We parse by splitting lines and extracting fields by position patterns.
 */
function parseDevicectlOutput(raw: string): RawPhysicalDevice[] {
  const devices: RawPhysicalDevice[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip header, separator, and empty lines
    if (!trimmed || trimmed.startsWith('Name') || trimmed.startsWith('-')) continue;
    // Skip Simulator/CoreSimulator entries
    if (trimmed.includes('Simulator') || trimmed.includes('CoreSimulator')) continue;

    // Extract UDID: UUID format with dashes (e.g., F7C1CF80-8A2C-5AFB-85FE-C959DC4EC1F9)
    // or legacy 25-40 char hex format (e.g., 00008110-001234567890ABCD)
    const udidMatch =
      trimmed.match(
        /([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})/,
      ) ?? trimmed.match(/([0-9A-Fa-f]{25,40})/);
    if (!udidMatch?.[1]) continue;

    const udid = udidMatch[1];

    // Extract name: first word(s) before Hostname column
    // The hostname pattern is <something>.coredevice.local
    const hostnameIdx = trimmed.indexOf('.coredevice.local');
    const name =
      hostnameIdx > 0
        ? trimmed
            .slice(0, hostnameIdx)
            .trim()
            .split(/\s{2,}/)
            .filter(Boolean)
            .slice(0, -1)
            .join(' ') || undefined
        : undefined;

    // Extract model: e.g., "iPhone 14 Plus (iPhone14,8)" → "iPhone14,8"
    const modelMatch = trimmed.match(/\(([A-Za-z0-9,]+)\)\s*$/);
    const model = modelMatch?.[1] ?? undefined;

    // Extract OS version from devicectl device info (best-effort)
    const versionMatch = trimmed.match(/(\d+\.\d+(?:\.\d+)?)/);

    // State inference from the State column
    let state: PhysicalDeviceState = 'healthy';
    const stateLower = trimmed.toLowerCase();
    if (stateLower.includes('unavailable')) {
      state = 'busy';
    } else if (stateLower.includes('untrusted') || stateLower.includes('not trusted')) {
      state = 'untrusted';
    } else if (stateLower.includes('developer mode')) {
      state = 'developer_mode_off';
    } else if (stateLower.includes('busy')) {
      state = 'busy';
    }
    // "available (paired)" → healthy

    devices.push({
      udid,
      name,
      model,
      osVersion: versionMatch?.[1], // best-effort, will be refined below
      state,
    });
  }

  return devices;
}

/**
 * Cross-check with xcdevice (Phase 0 §4.7).
 * xcdevice may report availability when devicectl says unavailable.
 */
function parseXcdeviceOutput(raw: string): Map<string, { available: boolean; name?: string }> {
  const map = new Map<string, { available: boolean; name?: string }>();
  try {
    const data = JSON.parse(raw);
    // xcdevice output: array of { identifier, name, available, ... }
    const items = Array.isArray(data) ? data : (data?.devices ?? []);
    for (const item of items) {
      if (item?.identifier && !item?.simulator) {
        map.set(item.identifier, {
          available: item.available === true,
          name: item.name,
        });
      }
    }
  } catch {
    // xcdevice not available — non-fatal
  }
  return map;
}

/**
 * Merge devicectl and xcdevice results.
 * xcdevice is used to cross-check availability (Phase 0 §4.7).
 * If devicectl says busy but xcdevice says available, we downgrade to healthy with a note.
 */
function mergePhysicalResults(
  devicectlDevices: RawPhysicalDevice[],
  xcdeviceMap: Map<string, { available: boolean; name?: string }>,
): RawPhysicalDevice[] {
  return devicectlDevices.map((d) => {
    const xc = xcdeviceMap.get(d.udid);
    if (!xc) return d;

    // Heal: devicectl says busy but xcdevice says available
    if (d.state === 'busy' && xc.available) {
      return { ...d, state: 'healthy', name: d.name ?? xc.name };
    }
    // If xcdevice has a name and we don't
    if (!d.name && xc.name) {
      return { ...d, name: xc.name };
    }

    return d;
  });
}

/**
 * Attempt to get device details via devicectl device info details.
 * Parses key-value output to extract model name, product type, and OS version.
 */
function tryGetDeviceDetails(udid: string): {
  model?: string;
  osVersion?: string;
  developerMode?: boolean;
} {
  const info = exec(['xcrun', 'devicectl', 'device', 'info', 'details', '--device', udid]);
  if (info.exitCode !== 0) return {};

  const output = info.stdout;
  const modelMatch = output.match(/marketingName:\s*(.+)/);
  const versionMatch = output.match(/osVersionNumber:\s*([\d.]+)/);
  const devModeMatch = output.match(/developerModeStatus:\s*(\w+)/);

  return {
    model: modelMatch?.[1]?.trim(),
    osVersion: versionMatch?.[1],
    developerMode: devModeMatch?.[1] === 'enabled',
  };
}

/**
 * Discover physical (iPhone) devices connected via USB.
 *
 * Data sources (US-2.1 AC3):
 *   1. xcrun devicectl list devices (primary)
 *   2. xcrun xcdevice list (cross-check, Phase 0 §4.7)
 *   3. xcrun devicectl device info details --device <udid> (model + OS, best-effort)
 */
export async function discoverPhysicalDevices(): Promise<DeviceInfo[]> {
  const devicectl = exec(['xcrun', 'devicectl', 'list', 'devices']);
  const xcdevice = exec(['xcrun', 'xcdevice', 'list']);

  if (devicectl.exitCode !== 0) {
    return [];
  }

  const rawDevices = parseDevicectlOutput(devicectl.stdout);
  const xcdeviceMap = parseXcdeviceOutput(xcdevice.stdout);
  const merged = mergePhysicalResults(rawDevices, xcdeviceMap);

  // Enrich with device info (model + OS version) for each device
  const enrichedDevices = await Promise.all(
    merged.map(async (d) => {
      const details = tryGetDeviceDetails(d.udid);
      return {
        ...d,
        model: d.model ?? details.model,
        osVersion: d.osVersion ?? details.osVersion,
      };
    }),
  );

  return enrichedDevices.map((d) =>
    DeviceInfoSchema.parse({
      udid: d.udid,
      name: d.name,
      model: d.model,
      osVersion: d.osVersion,
      platform: 'ios' as const,
      targetKind: 'physical' as const,
      state: undefined,
    }),
  );
}

// ─── Simulator device discovery ─────────────────────────────

interface SimDevice {
  name: string;
  udid: string;
  state: string;
  runtime: string;
  deviceTypeIdentifier: string;
  isAvailable: boolean;
}

/**
 * Parse `xcrun simctl list devices --json` output.
 * Defense: keys may vary across Xcode versions — Zod .passthrough() handles this.
 */
function parseSimctlDevices(raw: string): SimDevice[] {
  try {
    const parsed = JSON.parse(raw);
    const devicesMap = parsed.devices ?? parsed;
    const result: SimDevice[] = [];

    if (typeof devicesMap !== 'object' || devicesMap === null) return [];

    for (const [runtimeKey, deviceList] of Object.entries(devicesMap)) {
      if (!Array.isArray(deviceList)) continue;
      for (const d of deviceList) {
        if (typeof d !== 'object' || d === null) continue;
        const dObj = d as Record<string, unknown>;
        result.push({
          name: String(dObj.name ?? 'unknown'),
          udid: String(dObj.udid ?? ''),
          state: String(dObj.state ?? 'unknown'),
          runtime: runtimeKey,
          deviceTypeIdentifier: String(dObj.deviceTypeIdentifier ?? 'unknown'),
          isAvailable: dObj.isAvailable !== false, // default true if absent
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Extract iOS version from runtime identifier.
 * e.g. "com.apple.CoreSimulator.SimRuntime.iOS-18-2" → "18.2"
 */
function extractOSVersion(runtimeIdentifier: string): string | undefined {
  const match = runtimeIdentifier.match(/iOS[- ](\d+)[-.](\d+)(?:[-.](\d+))?/);
  if (!match) return undefined;
  return match[3] ? `${match[1]}.${match[2]}.${match[3]}` : `${match[1]}.${match[2]}`;
}

/**
 * Discover iOS Simulator devices.
 *
 * Data source (US-2.3 AC1):
 *   xcrun simctl list devices --json
 */
export async function discoverSimulatorDevices(): Promise<DeviceInfo[]> {
  const simctl = exec(['xcrun', 'simctl', 'list', 'devices', '--json']);

  if (simctl.exitCode !== 0 || !simctl.stdout) {
    return [];
  }

  const simDevices = parseSimctlDevices(simctl.stdout);

  // Filter: only available iOS simulators (exclude watchOS, tvOS, etc.)
  const iosDevices = simDevices.filter((d) => d.isAvailable && d.runtime.includes('iOS'));

  return iosDevices.map((d) =>
    DeviceInfoSchema.parse({
      udid: d.udid,
      name: d.name,
      model: d.deviceTypeIdentifier,
      osVersion: extractOSVersion(d.runtime),
      platform: 'ios' as const,
      targetKind: 'simulator' as const,
      runtimeIdentifier: d.runtime,
      deviceTypeIdentifier: d.deviceTypeIdentifier,
      state: d.state.toLowerCase() as DeviceInfo['state'],
    }),
  );
}

// ─── Unified discovery ──────────────────────────────────────

/**
 * Discover all available devices — physical (USB) + Simulator.
 *
 * US-2.3 AC1: itestagent devices lists both physical and simulator devices simultaneously.
 * AGENTS.md §2 (R2): relies on xcrun devicectl + xcrun simctl, no self-built interaction.
 */
export async function discoverAllDevices(): Promise<DeviceInfo[]> {
  const [physical, simulator] = await Promise.all([
    discoverPhysicalDevices(),
    discoverSimulatorDevices(),
  ]);

  // Sort: physical first, then simulator; within each group, by name
  return [...physical, ...simulator].sort((a, b) => {
    if (a.targetKind !== b.targetKind) {
      return a.targetKind === 'physical' ? -1 : 1;
    }
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}
