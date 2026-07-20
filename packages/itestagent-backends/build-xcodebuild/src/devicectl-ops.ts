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
  openDeepLink(udid: string, bundleId: string, url: string): Promise<DevicectlResult>;
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

/**
 * Extract the PID for a given bundleId from devicectl process listing.
 *
 * Format: "<pid>    <path>" — whitespace-separated, PID first.
 * Example: "1499    /private/var/.../TestSwiftUI.app/TestSwiftUI"
 *
 * Returns the PID as a string, or null if not found.
 */
function extractPidFromProcessList(processesOutput: string, bundleId: string): string | null {
  if (!processesOutput) return null;

  const lines = processesOutput.split('\n');
  // The bundleId's last component (e.g., "TestSwiftUI" from "name.logan.TestSwiftUI")
  // appears in the process path. Match against the full bundle ID and the app name.
  const appName = bundleId.split('.').pop() ?? bundleId;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match lines where the path contains the app name or full bundle ID
    if (trimmed.includes(appName) || trimmed.includes(bundleId)) {
      // Extract PID: first column (whitespace-separated)
      const pidMatch = trimmed.match(/^(\d+)/);
      if (pidMatch?.[1]) {
        return pidMatch[1];
      }
    }
  }

  return null;
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
    const result = await spawnAsync('xcrun', [
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

    const result = await spawnAsync('xcrun', args);

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
   * Terminate (kill) an app process on a physical device by bundle ID.
   *
   * Two-step process:
   *   1. List running processes via devicectl device info processes --device <UDID>
   *   2. Filter by bundle/app name, extract PID, then terminate via --pid <pid>
   *
   * Command: xcrun devicectl device process terminate --device <UDID> --pid <pid>
   */
  async function terminateApp(udid: string, bundleId: string): Promise<DevicectlResult> {
    // Step 1: Find the PID by listing processes
    const listResult = spawnSync('xcrun', [
      'devicectl',
      'device',
      'info',
      'processes',
      '--device',
      udid,
    ]);

    if (listResult.exitCode !== 0) {
      return {
        success: false,
        error: categorizeDevicectlError('devicectl list processes', udid, listResult),
        exitCode: listResult.exitCode,
        stderr: listResult.stderr,
      };
    }

    // Parse PID from process listing.
    // Format: "<pid>    <path>" — extract PID where the path contains the bundleId.
    const pid = extractPidFromProcessList(listResult.stdout, bundleId);
    if (pid === null) {
      return {
        success: false,
        error: `devicectl terminate failed: app "${bundleId}" is not running on device "${udid}"`,
      };
    }

    // Step 2: Terminate by PID
    const terminateResult = spawnSync('xcrun', [
      'devicectl',
      'device',
      'process',
      'terminate',
      '--device',
      udid,
      '--pid',
      pid,
    ]);

    if (terminateResult.exitCode !== 0) {
      return {
        success: false,
        error: categorizeDevicectlError('devicectl terminate', udid, terminateResult),
        exitCode: terminateResult.exitCode,
        stderr: terminateResult.stderr,
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
   * The caller must provide the bundleId for the app that handles the URL scheme.
   */
  async function openDeepLink(
    udid: string,
    bundleId: string,
    url: string,
  ): Promise<DevicectlResult> {
    const result = spawnSync('xcrun', [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      udid,
      bundleId,
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
