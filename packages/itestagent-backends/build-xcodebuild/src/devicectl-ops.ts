/**
 * DevicectlOps — physical device app lifecycle operations via devicectl.
 *
 * US-6.2 AC1: install .app via devicectl
 * US-6.2 AC4: launch / terminate / deep link after install
 *
 * Dependencies are injectable for testability (same pattern as XcodebuildBuildDriver).
 *
 * AGENTS.md R2: Uses xcrun devicectl (Apple official), does not re-implement.
 * AGENTS.md R5: Never silently degrade — all errors returned explicitly.
 * AGENTS.md R12: All code/comments in English.
 */

import type { SpawnAsyncFn, SpawnSyncFn, SyncSpawnResult } from './xcodebuild-build-driver.js';

// ─── Types ────────────────────────────────────────────────────────

/** Result of a devicectl operation. */
export interface DevicectlResult {
  success: boolean;
  /** Human-readable error message (R5: never silent). */
  error?: string;
  exitCode?: number;
  stderr?: string;
}

/** Injectable dependencies for devicectl operations. */
export interface DevicectlDeps {
  spawnSync: SpawnSyncFn;
  spawnAsync: SpawnAsyncFn;
}

/** Object returned by createDevicectlOps. */
export interface DevicectlOps {
  installApp(udid: string, appPath: string): Promise<DevicectlResult>;
  launchApp(udid: string, bundleId: string, launchArgs?: string[]): Promise<DevicectlResult>;
  terminateApp(udid: string, bundleId: string): Promise<DevicectlResult>;
  openDeepLink(udid: string, url: string): Promise<DevicectlResult>;
}

// ─── Default implementations ──────────────────────────────────────

/** Default synchronous spawn using Bun.spawnSync. */
const defaultSpawnSync: SpawnSyncFn = (cmd, args, cwd) => {
  try {
    const result = Bun.spawnSync({
      cmd: [cmd, ...args],
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  } catch {
    return { exitCode: -1, stdout: '', stderr: `command not found: ${cmd}` };
  }
};

/** Default asynchronous spawn using Bun.spawn. */
const defaultSpawnAsync: SpawnAsyncFn = async (cmd, args, cwd) => {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitInfo = await proc.exited;
    return {
      exitCode: exitInfo,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch {
    return { exitCode: -1, stdout: '', stderr: `command not found: ${cmd}` };
  }
};

// ─── Error categorization ─────────────────────────────────────────

/**
 * Categorize devicectl errors into user-actionable messages.
 *
 * R5 compliance: never just "install failed" — explain WHY and suggest fixes.
 */
function categorizeDevicectlError(action: string, udid: string, result: SyncSpawnResult): string {
  const stderr = result.stderr.toLowerCase();

  if (stderr.includes('device not found') || stderr.includes('no device matched')) {
    return `${action} failed: device "${udid}" not found. Check: xcrun devicectl list devices`;
  }
  if (stderr.includes('untrusted') || stderr.includes('not trusted')) {
    return `${action} failed: device not trusted. Unlock iPhone and tap "Trust This Computer"`;
  }
  if (stderr.includes('developer mode') || stderr.includes('developer_mode')) {
    return `${action} failed: Developer Mode not enabled. Enable in Settings > Privacy & Security > Developer Mode`;
  }
  if (stderr.includes('locked') || stderr.includes('passcode')) {
    return `${action} failed: device is locked. Unlock the iPhone and retry`;
  }
  if (stderr.includes('app not installed') || stderr.includes('no such app')) {
    return `${action} failed: app not found on device. Verify the app was installed successfully`;
  }
  if (stderr.includes('already running')) {
    return `${action} failed: process is already running`;
  }

  // Generic fallback — include raw stderr for diagnosis (R5: never hide details).
  const errMsg = stderr ? stderr.slice(0, 500) : result.stdout.slice(0, 500) || 'unknown error';
  return `${action} failed: ${errMsg}`;
}

// ─── Implementation ───────────────────────────────────────────────

/**
 * Create a DevicectlOps instance with injectable dependencies.
 *
 * @param deps - Injectable dependencies. Uses real spawn by default.
 */
export function createDevicectlOps(deps?: Partial<DevicectlDeps>): DevicectlOps {
  const spawnSync = deps?.spawnSync ?? defaultSpawnSync;
  const spawnAsync = deps?.spawnAsync ?? defaultSpawnAsync;

  // ─── installApp ─────────────────────────────────────────────

  /**
   * Install an .app bundle to a physical device.
   *
   * Command: xcrun devicectl device install app --device <UDID> <appPath>
   */
  async function installApp(udid: string, appPath: string): Promise<DevicectlResult> {
    const result = spawnSync('xcrun', [
      'devicectl',
      'device',
      'install',
      'app',
      '--device',
      udid,
      appPath,
    ]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: categorizeDevicectlError('devicectl install', udid, result),
        exitCode: result.exitCode,
        stderr: result.stderr,
      };
    }

    return { success: true };
  }

  // ─── launchApp ──────────────────────────────────────────────

  /**
   * Launch an app on a physical device.
   *
   * Command: xcrun devicectl device process launch --device <UDID> <bundleId>
   *
   * Optionally pass launch arguments for deep linking or environment configuration.
   */
  async function launchApp(
    udid: string,
    bundleId: string,
    launchArgs?: string[],
  ): Promise<DevicectlResult> {
    const args: string[] = ['devicectl', 'device', 'process', 'launch', '--device', udid, bundleId];

    if (launchArgs && launchArgs.length > 0) {
      args.push('--terminate-existing');
      args.push('--args', ...launchArgs);
    }

    const result = spawnSync('xcrun', args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: categorizeDevicectlError('devicectl launch', udid, result),
        exitCode: result.exitCode,
        stderr: result.stderr,
      };
    }

    return { success: true };
  }

  // ─── terminateApp ───────────────────────────────────────────

  /**
   * Terminate (kill) an app process on a physical device.
   *
   * Command: xcrun devicectl device process terminate --device <UDID> <bundleId>
   */
  async function terminateApp(udid: string, bundleId: string): Promise<DevicectlResult> {
    const result = spawnSync('xcrun', [
      'devicectl',
      'device',
      'process',
      'terminate',
      '--device',
      udid,
      bundleId,
    ]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: categorizeDevicectlError('devicectl terminate', udid, result),
        exitCode: result.exitCode,
        stderr: result.stderr,
      };
    }

    return { success: true };
  }

  // ─── openDeepLink ───────────────────────────────────────────

  /**
   * Open a deep link / URL scheme on a physical device.
   *
   * Command: xcrun devicectl device process launch --device <UDID> <bundleId> --args "<url>"
   *
   * Note: deep links require the target app to be installed on the device.
   * The caller must know the bundleId for the URL scheme.
   */
  async function openDeepLink(udid: string, url: string): Promise<DevicectlResult> {
    // Deep links via devicectl require launching the app with the URL as a launch argument.
    // The caller specifies which app to launch via its bundleId.
    // For generic URLs (https://), iOS opens the default browser — no bundleId needed.
    const result = spawnSync('xcrun', [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      udid,
      '--args',
      url,
    ]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: categorizeDevicectlError('devicectl open deep link', udid, result),
        exitCode: result.exitCode,
        stderr: result.stderr,
      };
    }

    return { success: true };
  }

  // ─── Return interface ───────────────────────────────────────

  return {
    installApp,
    launchApp,
    terminateApp,
    openDeepLink,
  };
}
