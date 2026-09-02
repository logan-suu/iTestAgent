import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceDiscoverySnapshotSchema } from 'itestagent-contracts';
import type {
  DeviceDiscoveryIssue,
  DeviceDiscoveryOptions,
  DeviceDiscoveryProvider,
  DeviceDiscoverySnapshot,
  DeviceInfo,
} from 'itestagent-contracts';

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

export class DeviceDiscoveryError extends Error {
  constructor(readonly issue: DeviceDiscoveryIssue) {
    super(issue.message);
    this.name = 'DeviceDiscoveryError';
  }
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
    // CoreDevice cold-start regularly exceeds three seconds on real hosts.
    // Keep the probe bounded, but allow enough time for devicectl to initialise.
    const timeout = setTimeout(
      () => controller.abort(new Error(`Device discovery timed out: ${command.join(' ')}`)),
      15_000,
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
    return createDeviceDiscoveryTempPath();
  },
  exists: existsSync,
  readText(path) {
    return readFileSync(path, 'utf-8');
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};

export function createDeviceDiscoveryTempPath(): string {
  return join(tmpdir(), `itestagent-devlist-${process.pid}-${randomUUID()}.json`);
}

export function parsePhysicalDevices(parsed: DevicectlListOutput): DeviceInfo[] {
  const devices = parsed.result?.devices ?? parsed.devices ?? [];
  return devices
    .filter((device) => {
      const connection = device.connectionProperties;
      if (!connection) return false;
      // Xcode 26 reports an available paired device as localNetwork + disconnected
      // until an operation opens the CoreDevice tunnel. Pairing proves discovery;
      // the production replay readiness probe separately proves WDA is active.
      if (connection.pairingState === 'paired') return true;
      return connection.tunnelState === 'connected' || connection.tunnelState === 'available';
    })
    .map((device) => ({
      udid: String(device.hardwareProperties?.udid ?? ''),
      name: device.deviceProperties?.name,
      model: device.hardwareProperties?.productType,
      osVersion: device.deviceProperties?.osVersionNumber,
      platform: 'ios' as const,
      targetKind: 'physical' as const,
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
        state: normalizeSimulatorState(device.state),
      });
    }
  }

  return results;
}

function normalizeSimulatorState(raw: unknown): NonNullable<DeviceInfo['state']> {
  const normalized = String(raw ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'booted':
    case 'shutdown':
    case 'creating':
    case 'booting':
    case 'shutting_down':
      return normalized;
    default:
      return 'unknown';
  }
}

function discoveryError(
  lane: DeviceDiscoveryIssue['lane'],
  code: DeviceDiscoveryIssue['code'],
  message: string,
): DeviceDiscoveryError {
  return new DeviceDiscoveryError({ lane, code, ...boundedIssueMessage(message) });
}

function toDiscoveryIssue(
  lane: DeviceDiscoveryIssue['lane'],
  error: unknown,
): DeviceDiscoveryIssue {
  if (error instanceof DeviceDiscoveryError) return error.issue;
  const message = error instanceof Error ? error.message : String(error);
  return {
    lane,
    code: 'command_failed',
    ...boundedIssueMessage(message),
  };
}

const MAX_ISSUE_MESSAGE_LENGTH = 2_000;

function boundedIssueMessage(message: string): Pick<DeviceDiscoveryIssue, 'message' | 'truncated'> {
  const redacted = message
    .replace(/\b(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED]')
    .replace(/\b(password|token|secret)=([^\s]+)/gi, '$1=[REDACTED]');
  if (redacted.length <= MAX_ISSUE_MESSAGE_LENGTH) return { message: redacted };
  return {
    message: `${redacted.slice(0, MAX_ISSUE_MESSAGE_LENGTH)}... [truncated]`,
    truncated: true,
  };
}

async function discoverPhysicalDevicesStrict(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceInfo[]> {
  const jsonPath = runtime.createTempJsonPath();
  try {
    const result = await runtime.run(
      ['xcrun', 'devicectl', 'list', 'devices', '--json-output', jsonPath],
      signal,
    );
    if (result.exitCode !== 0) {
      throw discoveryError(
        'physical',
        'command_failed',
        `devicectl device discovery failed with exit code ${result.exitCode}: ${result.stderr.trim() || 'no stderr'}`,
      );
    }
    if (!runtime.exists(jsonPath)) {
      throw discoveryError('physical', 'missing_output', 'devicectl did not create JSON output');
    }
    try {
      return parsePhysicalDevices(JSON.parse(runtime.readText(jsonPath)) as DevicectlListOutput);
    } catch (error: unknown) {
      throw discoveryError(
        'physical',
        'invalid_output',
        `devicectl returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    try {
      runtime.remove(jsonPath);
    } catch {
      // Cleanup is best-effort; discovery results must not depend on temp-file removal.
    }
  }
}

export async function discoverPhysicalDevices(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceInfo[]> {
  try {
    return await discoverPhysicalDevicesStrict(signal, runtime);
  } catch (error: unknown) {
    if (signal?.aborted) throw error;
    return [];
  }
}

async function discoverSimulatorDevicesStrict(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceInfo[]> {
  try {
    const result = await runtime.run(['xcrun', 'simctl', 'list', 'devices', '--json'], signal);
    if (result.exitCode !== 0) {
      throw discoveryError(
        'simulator',
        'command_failed',
        `simctl device discovery failed with exit code ${result.exitCode}: ${result.stderr.trim() || 'no stderr'}`,
      );
    }
    if (!result.stdout.trim()) {
      throw discoveryError('simulator', 'missing_output', 'simctl returned empty JSON output');
    }
    try {
      return parseSimulatorDevices(result.stdout);
    } catch (error: unknown) {
      throw discoveryError(
        'simulator',
        'invalid_output',
        `simctl returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof DeviceDiscoveryError) throw error;
    throw discoveryError(
      'simulator',
      'command_failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function discoverSimulatorDevices(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceInfo[]> {
  try {
    return await discoverSimulatorDevicesStrict(signal, runtime);
  } catch (error: unknown) {
    if (signal?.aborted) throw error;
    return [];
  }
}

export async function discoverDeviceInventory(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceDiscoverySnapshot> {
  return discoverRequestedDeviceInventory({ signal }, runtime);
}

async function discoverRequestedDeviceInventory(
  options: DeviceDiscoveryOptions,
  runtime: DeviceDiscoveryRuntime,
): Promise<DeviceDiscoverySnapshot> {
  const lanes = options.lanes?.length
    ? [...new Set(options.lanes)]
    : (['physical', 'simulator'] as const);
  const settled = await Promise.allSettled(
    lanes.map(async (lane) => ({
      lane,
      devices:
        lane === 'physical'
          ? await discoverPhysicalDevicesStrict(options.signal, runtime)
          : await discoverSimulatorDevicesStrict(options.signal, runtime),
    })),
  );
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error('Device discovery aborted');
  }

  const devices = settled.flatMap((result) =>
    result.status === 'fulfilled' ? result.value.devices : [],
  );
  devices.sort((left, right) => {
    if (left.targetKind !== right.targetKind) return left.targetKind === 'physical' ? -1 : 1;
    return (left.name ?? '').localeCompare(right.name ?? '');
  });
  const issues = settled.flatMap((result, index) =>
    result.status === 'rejected'
      ? [toDiscoveryIssue(lanes[index] ?? 'physical', result.reason)]
      : [],
  );

  return DeviceDiscoverySnapshotSchema.parse({
    devices,
    status: issues.length === 0 ? 'ok' : issues.length === lanes.length ? 'failed' : 'partial',
    issues,
  });
}

export function createAppiumDeviceDiscoveryProvider(
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): DeviceDiscoveryProvider {
  return {
    discover: (options = {}) => discoverRequestedDeviceInventory(options, runtime),
  };
}

export async function discoverDevices(
  signal?: AbortSignal,
  runtime: DeviceDiscoveryRuntime = defaultRuntime,
): Promise<DeviceInfo[]> {
  const inventory = await discoverDeviceInventory(signal, runtime);
  if (inventory.status !== 'ok') {
    throw new AggregateError(
      inventory.issues.map((issue) => new DeviceDiscoveryError(issue)),
      `Device discovery ${inventory.status}: ${inventory.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return inventory.devices;
}
