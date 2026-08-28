/**
 * Simulator device operations over `xcrun simctl` — B12 module split
 * (promotion guide §11.3 "build-xcodebuild", §6.1 "simctl … build drivers").
 *
 * All operations run through an injected process runner so tests script tool
 * behavior without spawning real simulators. Non-zero exits surface typed
 * failures carrying the exit code and CLI stderr (fail-closed, R5).
 */
import type { XcodebuildProcessRunner } from './xcodebuild-process-types.js';

export interface SimctlDeviceEntry {
  udid: string;
  name: string;
  state: string;
}

export interface SimctlOps {
  /** Flattened entries across all runtime buckets of `simctl list devices --json`. */
  listDevices(): Promise<SimctlDeviceEntry[]>;
  boot(udid: string): Promise<void>;
  shutdown(udid: string): Promise<void>;
  isBooted(udid: string): Promise<boolean>;
  installApp(udid: string, appPath: string): Promise<void>;
  launchApp(udid: string, bundleId: string): Promise<void>;
  terminateApp(udid: string, bundleId: string): Promise<void>;
}

async function runAssert(
  runner: XcodebuildProcessRunner,
  cmd: string,
  args: string[],
  actionLabel: string,
): Promise<void> {
  const result = await runner(cmd, args);
  if (result.exitCode !== 0) {
    throw new Error(
      `simctl ${actionLabel} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
    );
  }
}

export function createSimctlOps(runner: XcodebuildProcessRunner, simctlPath = 'xcrun'): SimctlOps {
  return {
    async listDevices(): Promise<SimctlDeviceEntry[]> {
      const result = await runner(simctlPath, ['simctl', 'list', 'devices', '--json']);
      let doc: unknown;
      try {
        doc = JSON.parse(result.stdout) as unknown;
      } catch {
        throw new Error('simctl list devices: output is not valid JSON');
      }
      const devicesBucket = (doc as Record<string, unknown> | null)?.devices;
      if (typeof devicesBucket !== 'object' || devicesBucket === null) {
        throw new Error('simctl list devices: unexpected output shape');
      }
      const entries: SimctlDeviceEntry[] = [];
      for (const bucket of Object.values(devicesBucket as Record<string, unknown>)) {
        if (!Array.isArray(bucket)) continue;
        for (const entry of bucket as Record<string, unknown>[]) {
          const udid = typeof entry.udid === 'string' ? entry.udid : undefined;
          const name = typeof entry.name === 'string' ? entry.name : undefined;
          const state = typeof entry.state === 'string' ? entry.state : undefined;
          if (!udid || !name || !state) continue;
          entries.push({ udid, name, state });
        }
      }
      return entries;
    },

    async boot(udid: string): Promise<void> {
      await runAssert(runner, simctlPath, ['simctl', 'boot', udid], 'boot');
    },

    async shutdown(udid: string): Promise<void> {
      await runAssert(runner, simctlPath, ['simctl', 'shutdown', udid], `shutdown ${udid}`);
    },

    async isBooted(udid: string): Promise<boolean> {
      const devices = await this.listDevices();
      return devices.some((device) => device.udid === udid && device.state === 'Booted');
    },

    async installApp(udid: string, appPath: string): Promise<void> {
      await runAssert(
        runner,
        simctlPath,
        ['simctl', 'install', udid, appPath],
        `install ${appPath}`,
      );
    },

    async launchApp(udid: string, bundleId: string): Promise<void> {
      await runAssert(
        runner,
        simctlPath,
        ['simctl', 'launch', udid, bundleId],
        `launch ${bundleId}`,
      );
    },

    async terminateApp(udid: string, bundleId: string): Promise<void> {
      await runAssert(
        runner,
        simctlPath,
        ['simctl', 'terminate', udid, bundleId],
        `terminate ${bundleId}`,
      );
    },
  };
}
