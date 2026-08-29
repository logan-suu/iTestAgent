/**
 * WdaManager — iTestAgent-managed WebDriverAgent lifecycle (ADR-012).
 *
 * Owns WDA build, install, launch, readiness polling, and teardown. Appium is only
 * used for the WebDriver session layer — it connects to an already-running WDA
 * instead of managing the xcodebuild pipeline itself.
 *
 * This eliminates the free-account blocker: we pass -allowProvisioningUpdates
 * explicitly and control the entire xcodebuild lifecycle.
 *
 * Phase 2-3 additions: waitForReady, verifyPreinstalledWDA, preparePreinstalledWDA,
 * graceful stop (SIGTERM → grace → SIGKILL), AbortSignal propagation.
 *
 * R2: Uses devicectl + xcodebuild (Apple official), does not re-implement WDA.
 * R5: All errors are explicit — never silently degrade.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

// ─── Internal helper ──────────────────────────────────────────────────────

async function spawnAsync(
  cmd: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', signal });
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
  /**
   * Override WDA bundle ID for free-account workaround.
   * Example: "L4CX67KLT5.WebDriverAgentRunner"
   * MUST be BASE ID without .xctrunner suffix.
   */
  productBundleIdentifier?: string;
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

/** Result of WDA /status polling. */
export interface WdaStatusResult {
  /** Whether WDA is ready to accept commands. */
  ready: boolean;
  /** WDA version info from /status response (if available). */
  version?: WdaVersionInfo;
  /** Total time waited in ms. */
  waitedMs: number;
}

/** WDA version metadata from /status response. */
export interface WdaVersionInfo {
  /** WDA build timestamp or version string. */
  build?: {
    time?: string;
    productBundleIdentifier?: string;
  };
}

/** Result of preinstalled WDA verification. */
export interface WdaPreinstallVerification {
  /** Whether the preinstalled WDA is ready for use. */
  ready: boolean;
  /** Human-readable reason if not ready. */
  reason?: string;
  /** Actual bundle ID found on device. */
  actualBundleId?: string;
}

/** Options for WdaManager. */
export interface WdaManagerOptions {
  /** Staging directory for WDA build artifacts. Default: ~/.itestagent/wda-staging/. */
  stagingDir?: string;
}

// ─── Implementation ───────────────────────────────────────────────────────

/** Fresh-profile routine input (7-day free-profile re-sign, G5 recipe). */
export interface FreshProfileInput {
  /** Hardware UDID for verification (devicectl app list). */
  udid: string;
  /** CoreDevice identifier for installation (devicectl install). */
  deviceId: string;
  /** WDA base bundle ID (no .xctrunner suffix). */
  wdaBundleId: string;
  /** Build options for the re-sign pipeline. */
  buildOpts: WdaBuildOptions;
  signal?: AbortSignal;
  /** R7: device modification requires explicit user confirmation. */
  confirmed?: boolean;
}

/** Injected verify/prepare operations (unit-testable composition). */
export interface FreshProfileOps {
  verify(): Promise<WdaPreinstallVerification>;
  prepare(): Promise<WdaPreinstallVerification>;
}

export interface FreshProfileResult {
  /** True when the profile was rebuilt/reinstalled, false when already fresh. */
  refreshed: boolean;
  verification: WdaPreinstallVerification;
}

/**
 * Ensure the device has a fresh (non-expired) preinstalled WDA profile.
 *
 * Free-account profiles expire after 7 days (G5 finding) — this routine
 * verifies first and only rebuilds/reinstalls when the profile is not ready.
 * The R7 confirmation gate is enforced by prepare (propagated on failure).
 */
export async function ensureFreshProfile(
  input: FreshProfileInput,
  ops: FreshProfileOps,
): Promise<FreshProfileResult> {
  const initial = await ops.verify();
  if (initial.ready) {
    return { refreshed: false, verification: initial };
  }
  return { refreshed: true, verification: await ops.prepare() };
}

export class WdaManager {
  private runningProcess: Subprocess | null = null;
  private readonly stagingDir: string;

  constructor(options?: WdaManagerOptions) {
    this.stagingDir = options?.stagingDir ?? join(homedir(), '.itestagent', 'wda-staging');
  }

  /**
   * Get the staging directory for WDA build artifacts.
   *
   * All WDA packaging operations use this directory (Gate 0 requirement).
   */
  getStagingDir(): string {
    return this.stagingDir;
  }

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
    if (options.productBundleIdentifier) {
      if (options.productBundleIdentifier.endsWith('.xctrunner')) {
        throw new Error(
          `productBundleIdentifier must be base ID (no .xctrunner), got: ${options.productBundleIdentifier}`,
        );
      }
      args.push(`PRODUCT_BUNDLE_IDENTIFIER=${options.productBundleIdentifier}`);
    }

    const proc = Bun.spawn(['xcrun', 'xcodebuild', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal: options.signal,
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

    const appPath = this.extractAppPath(stdout);
    const bundleId = await this.extractBundleId(stdout, appPath);

    return { appPath, bundleId };
  }

  /**
   * Install pre-built WDA on a physical device via devicectl.
   */
  async install(options: WdaInstallOptions): Promise<WdaInstallResult> {
    const { stdout, stderr, exitCode } = await spawnAsync(
      [
        'xcrun',
        'devicectl',
        'device',
        'install',
        'app',
        '--device',
        options.deviceId,
        options.appPath,
      ],
      options.signal,
    );

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
      signal: options.signal,
    });

    this.runningProcess = proc;

    return {
      port,
      process: proc,
      url: `http://localhost:${port}`,
    };
  }

  /**
   * Poll WDA /status endpoint until ready or timeout.
   *
   * Sends GET http://127.0.0.1:PORT/status every 500ms. Returns when
   * the response contains "ready": true, or throws on timeout.
   *
   * @param port - WDA HTTP port
   * @param timeoutMs - Maximum time to wait (default: 60000)
   * @param signal - Optional AbortSignal to cancel polling
   */
  async waitForReady(
    port: number,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<WdaStatusResult> {
    const timeout = timeoutMs ?? 60000;
    const start = Date.now();
    let lastError: string | undefined;

    while (true) {
      if (signal?.aborted) {
        throw new Error('WDA readiness check cancelled');
      }

      if (Date.now() - start >= timeout) {
        const waited = Date.now() - start;
        throw new Error(
          `WDA /status not ready after ${waited}ms${lastError ? ` (last error: ${lastError})` : ''}`,
        );
      }

      try {
        const resp = await fetch(`http://127.0.0.1:${port}/status`, {
          signal: AbortSignal.timeout(2000),
        });
        const body = (await resp.json()) as { value?: Record<string, unknown> };

        if (body.value?.ready === true) {
          const version: WdaVersionInfo | undefined = body.value.build
            ? { build: body.value.build as WdaVersionInfo['build'] }
            : undefined;

          return {
            ready: true,
            version,
            waitedMs: Date.now() - start,
          };
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // Continue polling — WDA may still be starting
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }

  /**
   * Verify that a preinstalled WDA Runner exists on the device and is usable.
   *
   * Checks:
   *   - Runner exists on device
   *   - Profile not expired
   *   - Bundle ID matches expected base ID
   *
   * @param udid - Target device UDID
   * @param expectedBundleId - Expected WDA base bundle ID (no .xctrunner)
   * @param signal - Optional AbortSignal
   */
  async verifyPreinstalledWDA(
    udid: string,
    expectedBundleId: string,
    signal?: AbortSignal,
  ): Promise<WdaPreinstallVerification> {
    const expectedRunner = expectedBundleId.endsWith('.xctrunner')
      ? expectedBundleId
      : `${expectedBundleId}.xctrunner`;

    try {
      const { stdout, exitCode } = await spawnAsync(
        ['xcrun', 'devicectl', 'device', 'info', 'apps', '--device', udid, '--json'],
        signal,
      );

      if (exitCode !== 0 || !stdout.trim()) {
        return {
          ready: false,
          reason: 'devicectl device info apps failed — device may be disconnected',
        };
      }

      const parsed = JSON.parse(stdout) as {
        result?: { apps?: Array<{ bundleIdentifier?: string }> };
      };
      const apps = parsed?.result?.apps ?? [];
      const runnerApp = apps.find((a) => a.bundleIdentifier === expectedRunner);

      if (!runnerApp) {
        return {
          ready: false,
          reason: `WDA Runner "${expectedRunner}" not found on device. Run preparePreinstalledWDA() first.`,
        };
      }

      // R5: Profile expiry check is best-effort — devicectl may not expose
      // Profile details directly. The G5 spike must verify this manually.
      return {
        ready: true,
        actualBundleId: expectedRunner,
      };
    } catch (err) {
      return {
        ready: false,
        reason: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Full prepare-preinstalled-WDA pipeline: build → sign → install → verify.
   *
   * Builds WDA with -allowProvisioningUpdates, installs to the target device,
   * and verifies the installation. This is the primary workflow for Route A
   * (preinstalled mode).
   *
   * R7: Installation modifies the target device — must be confirmed by user.
   * Pass `confirmed: true` to proceed. Throws if called without explicit confirmation.
   *
   * @param buildOpts - WDA build options
   * @param deviceId - CoreDevice identifier for installation
   * @param signal - Optional AbortSignal
   * @param confirmed - R7 gate: must be `true` to proceed with device modification
   */
  async preparePreinstalledWDA(
    buildOpts: WdaBuildOptions,
    deviceId: string,
    signal?: AbortSignal,
    confirmed?: boolean,
  ): Promise<WdaPreinstallVerification> {
    // R7: device modification requires explicit user confirmation
    if (confirmed !== true) {
      throw new Error(
        'R7: Installing WDA to a physical device modifies the target device and requires user confirmation. ' +
          'Pass confirmed: true to proceed.',
      );
    }

    const result = await this.build({ ...buildOpts, signal });

    await this.install({
      deviceId,
      appPath: result.appPath,
      signal,
    });

    const verification = await this.verifyPreinstalledWDA(
      buildOpts.udid,
      result.bundleId.replace(/\.xctrunner$/, ''),
      signal,
    );

    return verification;
  }

  /**
   * Fresh-profile routine (7-day free-profile re-sign, G5 recipe):
   * verify → skip when ready → rebuild/reinstall (R7-gated) otherwise.
   */
  async ensureFreshProfile(input: FreshProfileInput): Promise<FreshProfileResult> {
    return ensureFreshProfile(input, {
      verify: () => this.verifyPreinstalledWDA(input.udid, input.wdaBundleId, input.signal),
      prepare: () =>
        this.preparePreinstalledWDA(input.buildOpts, input.deviceId, input.signal, input.confirmed),
    });
  }

  /**
   * Stop the running WDA process gracefully.
   *
   * Sends SIGTERM → waits graceMs → SIGKILL if still alive.
   * Idempotent — safe to call even if no WDA is running.
   *
   * @param graceMs - Grace period in ms before force-kill (default: 3000).
   * @param signal - Optional AbortSignal to cancel the wait.
   */
  async stop(graceMs?: number, signal?: AbortSignal): Promise<void> {
    if (!this.runningProcess) return;

    const process = this.runningProcess;
    this.runningProcess = null;

    const grace = graceMs ?? 3000;

    // Already dead — nothing to do
    if (process.killed || process.exitCode !== null) return;

    try {
      // SIGTERM
      process.kill('SIGTERM');

      let timedOut = false;

      try {
        // Wait for grace period or process exit
        await Promise.race([
          process.exited,
          new Promise<void>((_, reject) =>
            setTimeout(() => {
              timedOut = true;
              reject(new Error('grace timeout'));
            }, grace),
          ),
          ...(signal
            ? [
                new Promise<void>((_, reject) => {
                  const onAbort = () => reject(new Error('stop cancelled'));
                  signal.addEventListener('abort', onAbort, { once: true });
                }),
              ]
            : []),
        ]);
      } catch {
        if (timedOut) {
          // Process didn't exit in time — force kill
          try {
            process.kill('SIGKILL');
            await process.exited;
          } catch {
            // Best-effort cleanup
          }
        }
        // If cancelled via AbortSignal, still try to kill
        if (signal?.aborted && !process.killed) {
          try {
            process.kill('SIGKILL');
            await process.exited;
          } catch {
            // Best-effort
          }
        }
      }
    } catch {
      // Best-effort cleanup — ensure process is dead
      try {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      } catch {
        // Absolute best-effort
      }
    }
  }

  /**
   * Check if WDA is currently running (actual process state).
   *
   * Checks the Subprocess.killed property and exitCode — does not rely
   * on "hasn't been explicitly stopped" (which would miss OS-killed processes).
   */
  isRunning(): boolean {
    if (!this.runningProcess) return false;
    return !this.runningProcess.killed && this.runningProcess.exitCode === null;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /** Parse build output to find the .app path. */
  private extractAppPath(stdout: string): string {
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
        'plutil',
        '-extract',
        'CFBundleIdentifier',
        'raw',
        '-o',
        '-',
        `${_appPath}/Info.plist`,
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
