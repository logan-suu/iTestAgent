import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceInfo } from 'itestagent-contracts';

export interface DeviceDiscoveryCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface DeviceDiscoveryRuntime {
  run(command: readonly string[], signal?: AbortSignal): Promise<DeviceDiscoveryCommandResult>;
  createTempJsonPath(): string;
  exists(path: string): boolean;
  readText(path: string): string;
  remove(path: string): void;
}

interface DevicectlDeviceEntry {
  connectionProperties?: {
    tunnelState?: string;
    transportType?: string;
    pairingState?: string;
  };
  hardwareProperties?: { udid?: string; productType?: string };
  deviceProperties?: { name?: string; osVersionNumber?: string };
}

interface DevicectlListOutput {
  result?: { devices?: DevicectlDeviceEntry[] };
  devices?: DevicectlDeviceEntry[];
}

const defaultRuntime: DeviceDiscoveryRuntime = {
  async run(command, signal) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`Device discovery timed out: ${command.join(' ')}`)),
      3_000,
    );
    try {
      const proc = Bun.spawn([...command], {
        stdout: 'pipe',
        stderr: 'pipe',
        signal: controller.signal,
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  },
  createTempJsonPath() {
    return join(tmpdir(), `itestagent-devlist-${process.pid}-${Date.now()}.json`);
  },
  exists: existsSync,
  readText(path) {
    return readFileSync(path, 'utf-8');
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};

export function parsePhysicalDevices(parsed: DevicectlListOutput): DeviceInfo[] {
  const devices = parsed.result?.devices ?? parsed.devices ?? [];
  return devices
    .filter((device) => {
      const connection = device.connectionProperties;
      if (!connection) return false;
      if (connection.transportType === 'wired' && connection.pairingState === 'paired') return true;
      return connection.tunnelState === 'connected' || connection.tunnelState === 'available';
    })
    .map((device) => ({
      udid: String(device.hardwareProperties?.udid ?? ''),
      name: device.deviceProperties?.name,
      model: device.hardwareProperties?.productType,
      osVersion: device.deviceProperties?.osVersionNumber,
      platform: 'ios' as const,
      targetKind: 'physical' as const,
      state: 'booted' as const,
    }))
    .filter((device) => device.udid !== '');
}

export function parseSimulatorDevices(raw: string): DeviceInfo[] {
  const parsed = JSON.parse(raw) as {
    devices?: Record<string, Array<Record<string, unknown>>>;
  };
  const results: DeviceInfo[] = [];

  for (const [runtimeKey, deviceList] of Object.entries(parsed.devices ?? {})) {
    if (!runtimeKey.includes('iOS') || !Array.isArray(deviceList)) continue;
    const osMatch = runtimeKey.match(/iOS[- ](\d+)[-.](\d+)(?:[-.](\d+))?/);
    const osVersion = osMatch
      ? [osMatch[1], osMatch[2], osMatch[3]].filter(Boolean).join('.')
      : undefined;

    for (const device of deviceList) {
      if (device.isAvailable === false) continue;
      const udid = String(device.udid ?? '');
      if (!udid) continue;
      results.push({
        udid,
        name: String(device.name ?? 'unknown'),
        model: String(device.deviceTypeIdentifier ?? 'unknown'),
        osVersion,
        platform: 'ios',
        targetKind: 'simulator',
        runtimeIdentifier: runtimeKey,
        deviceTypeIdentifier: String(device.deviceTypeIdentifier ?? ''),
        state: String(device.state ?? 'shutdown').toLowerCase() as DeviceInfo['state'],
      });
    }
  }

  return results;
}

export async function discoverPhysicalDevices(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceInfo[]> {
  const jsonPath = runtime.createTempJsonPath();
  try {
    const result = await runtime.run(
      ['xcrun', 'devicectl', 'list', 'devices', '--json-output', jsonPath],
      signal,
    );
    if (result.exitCode !== 0 || !runtime.exists(jsonPath)) return [];
    return parsePhysicalDevices(JSON.parse(runtime.readText(jsonPath)) as DevicectlListOutput);
  } catch {
    return [];
  } finally {
    try {
      runtime.remove(jsonPath);
    } catch {
      // Cleanup is best-effort; discovery results must not depend on temp-file removal.
    }
  }
}

export async function discoverSimulatorDevices(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceInfo[]> {
  try {
    const result = await runtime.run(['xcrun', 'simctl', 'list', 'devices', '--json'], signal);
    if (result.exitCode !== 0 || !result.stdout.trim()) return [];
    return parseSimulatorDevices(result.stdout);
  } catch {
    return [];
  }
}

export async function discoverDevices(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceInfo[]> {
  const [physical, simulator] = await Promise.all([
    discoverPhysicalDevices(signal, runtime),
    discoverSimulatorDevices(signal, runtime),
  ]);
  return [...physical, ...simulator].sort((left, right) => {
    if (left.targetKind !== right.targetKind) return left.targetKind === 'physical' ? -1 : 1;
    return (left.name ?? '').localeCompare(right.name ?? '');
  });
}
