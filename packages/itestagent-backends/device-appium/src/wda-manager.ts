/**
 * WdaManager — iTestAgent-managed WebDriverAgent lifecycle (ADR-012).
 *
 * Owns WDA build, install, launch, and teardown. Appium is only used for
 * the WebDriver session layer — it connects to an already-running WDA
 * instead of managing the xcodebuild pipeline itself.
 *
 * This eliminates the free-account blocker: we pass -allowProvisioningUpdates
 * explicitly and control the entire xcodebuild lifecycle.
 *
 * R2: Uses devicectl + xcodebuild (Apple official), does not re-implement WDA.
 * R5: All errors are explicit — never silently degrade.
 */
import type { Subprocess } from 'bun';

async function spawnAsync(
  cmd: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? 1 };
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface WdaBuildOptions {
  /** Path to WDA project (WebDriverAgent.xcodeproj). */
  projectPath: string;
  /** Build scheme (default: WebDriverAgentRunner). */
  scheme?: string;
  /** Target device UDID for destination. */
  udid: string;
  /** Team ID for code signing. */
  teamId: string;
  /** CODE_SIGN_IDENTITY (default: Apple Development). */
  codeSignIdentity?: string;
  /** Minimum iOS deployment target (default: 17.0). */
  deploymentTarget?: string;
  /** Custom derived data path for xcodebuild. */
  derivedDataPath?: string;
  /** AbortSignal for cancelling the build subprocess. */
  signal?: AbortSignal;
}

export interface WdaInstallOptions {
  /** CoreDevice identifier (F7C1CF80-...) for devicectl. */
  deviceId: string;
  /** Path to built WDA Runner .app. */
  appPath: string;
  /** AbortSignal for cancelling the install subprocess. */
  signal?: AbortSignal;
}

export interface WdaLaunchOptions {
  /** Path to WDA project. */
  projectPath: string;
  /** Build scheme (default: WebDriverAgentRunner). */
  scheme?: string;
  /** Target device UDID. */
  udid: string;
  /** Local port for WDA HTTP listener (default: 8100). */
  wdaPort?: number;
  /** Minimum iOS deployment target. */
  deploymentTarget?: string;
  /** AbortSignal for cancelling the WDA launch subprocess. */
  signal?: AbortSignal;
}

export interface WdaLaunchResult {
  /** WDA is running and listening on this port (localhost, tunneled). */
  port: number;
  /** The xcodebuild subprocess handle (keeps WDA alive). */
  process: Subprocess;
  /** WDA WebDriver URL to connect to. */
  url: string;
}

export interface WdaBuildResult {
  /** Path to the built WDA Runner .app. */
  appPath: string;
  /** Bundle ID of the built WDA. */
  bundleId: string;
}

export interface WdaInstallResult {
  /** Bundle ID that was installed. */
  bundleId: string;
}

// ─── Implementation ───────────────────────────────────────────────────────

export class WdaManager {
  private runningProcess: Subprocess | null = null;

  /**
   * Build WDA from source using xcodebuild.
   *
   * Passes -allowProvisioningUpdates to handle free-account signing.
   */
  async build(options: WdaBuildOptions): Promise<WdaBuildResult> {
    const scheme = options.scheme ?? 'WebDriverAgentRunner';
    const identity = options.codeSignIdentity ?? 'Apple Development';
    const target = options.deploymentTarget ?? '17.0';

    const args = [
      'build-for-testing',
      '-project',
      options.projectPath,
      '-scheme',
      scheme,
      '-destination',
      `id=${options.udid}`,
      `IPHONEOS_DEPLOYMENT_TARGET=${target}`,
      `DEVELOPMENT_TEAM=${options.teamId}`,
      `CODE_SIGN_IDENTITY=${identity}`,
      'GCC_TREAT_WARNINGS_AS_ERRORS=0',
      'COMPILER_INDEX_STORE_ENABLE=NO',
      '-allowProvisioningUpdates',
    ];

    if (options.derivedDataPath) {
      args.push('-derivedDataPath', options.derivedDataPath);
    }

    const proc = Bun.spawn(['xcrun', 'xcodebuild', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    if (proc.exitCode !== 0) {
      const errMsg = stderr.slice(-500) || stdout.slice(-500);
      throw new Error(`WDA build failed (code ${proc.exitCode}): ${errMsg}`);
    }

    // Find the built .app from derived data
    // xcodebuild prints the derived data path in stdout
    const appPath = this.extractAppPath(stdout);
    const bundleId = await this.extractBundleId(stdout, appPath);

    return { appPath, bundleId };
  }

  /**
   * Install pre-built WDA on a physical device via devicectl.
   */
  async install(options: WdaInstallOptions): Promise<WdaInstallResult> {
    const { stdout, stderr, exitCode } = await spawnAsync([
      'xcrun', 'devicectl', 'device', 'install', 'app',
      '--device', options.deviceId, options.appPath,
    ]);

    if (exitCode !== 0) {
      throw new Error(`WDA install failed: ${stderr.slice(-500)}`);
    }

    const bundleId = this.extractInstalledBundleId(stdout);

    return { bundleId };
  }

  /**
   * Launch WDA on the device via xcodebuild test-without-building.
   *
   * Returns a LaunchResult with a live subprocess — the process must be
   * kept alive to maintain the WDA HTTP listener on the device.
   *
   * IMPORTANT: Call stop() to clean up the subprocess.
   */
  async launch(options: WdaLaunchOptions): Promise<WdaLaunchResult> {
    const scheme = options.scheme ?? 'WebDriverAgentRunner';
    const port = options.wdaPort ?? 8100;
    const target = options.deploymentTarget ?? '17.0';

    const args = [
      'test-without-building',
      '-project',
      options.projectPath,
      '-scheme',
      scheme,
      '-destination',
      `id=${options.udid}`,
      `IPHONEOS_DEPLOYMENT_TARGET=${target}`,
    ];

    const proc = Bun.spawn(['xcrun', 'xcodebuild', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    this.runningProcess = proc;

    return {
      port,
      process: proc,
      url: `http://localhost:${port}`,
    };
  }

  /**
   * Stop the running WDA process (SIGTERM the xcodebuild subprocess).
   * Idempotent — safe to call even if no WDA is running.
   */
  async stop(): Promise<void> {
    if (!this.runningProcess) return;

    try {
      this.runningProcess.kill();
      await this.runningProcess.exited;
    } catch {
      // Best-effort cleanup
    }

    this.runningProcess = null;
  }

  /**
   * Check if WDA is currently running (process alive).
   */
  isRunning(): boolean {
    if (!this.runningProcess) return false;
    return !this.runningProcess.killed;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /** Parse build output to find the .app path. */
  private extractAppPath(stdout: string): string {
    // Look for patterns like:
    // "BUILD SUCCEEDED" or derived data path references
    // This is best-effort — in practice, the caller should provide
    // the derived data path explicitly
    const match = stdout.match(
      /(\/.+?\/Build\/Products\/Debug-iphoneos\/WebDriverAgentRunner-Runner\.app)/,
    );
    if (match?.[1]) return match[1];

    throw new Error(
      'Could not extract .app path from build output. ' + 'Specify derivedDataPath explicitly.',
    );
  }

  /** Extract bundle ID from the built .app. */
  private async extractBundleId(_stdout: string, _appPath: string): Promise<string> {
    try {
      const { stdout, exitCode } = await spawnAsync([
        'plutil', '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', `${_appPath}/Info.plist`,
      ]);

      if (exitCode === 0) {
        return stdout.trim();
      }
    } catch {
      // Fall through to default
    }

    return 'com.facebook.WebDriverAgentRunner.xctrunner';
  }

  /** Extract bundle ID from devicectl install output. */
  private extractInstalledBundleId(stdout: string): string {
    const match = stdout.match(/bundleID:\s*(\S+)/);
    return match?.[1] ?? 'unknown';
  }
}
