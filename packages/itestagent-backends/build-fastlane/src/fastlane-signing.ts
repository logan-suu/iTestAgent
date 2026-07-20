/**
 * Fastlane signing helper — wraps fastlane cert/sigh for provisioning and certificate management.
 *
 * US-6.2 AC3: When signing fails, provide fastlane as a fallback path.
 *
 * Used when the project has a Fastfile or when xcodebuild signing fails
 * and the user wants to use fastlane to fix it.
 *
 * AGENTS.md R2: Uses fastlane (reused tooling), does not re-implement signing.
 * AGENTS.md R5: Never silently degrade — all errors returned explicitly.
 * AGENTS.md R12: All code/comments in English.
 */

// ─── Types ────────────────────────────────────────────────────────

/** Injectable spawn function signature (same pattern as build-xcodebuild). */
export type FastlaneSpawnFn = (
  cmd: string,
  args: string[],
  cwd?: string,
) => { exitCode: number; stdout: string; stderr: string };

/** Result of a fastlane operation. */
export interface FastlaneResult {
  success: boolean;
  output: string;
  error?: string;
}

/** Configuration for fastlane sigh (provisioning profile management). */
export interface FastlaneSighInput {
  /** Bundle identifier for the provisioning profile. */
  bundleId: string;
  /** Developer portal team ID or name. */
  teamId?: string;
  /** Apple ID username (if not using fastlane's credential store). */
  username?: string;
  /** Output directory for certificates and profiles. */
  outputPath?: string;
  /** Ad-hoc or development. Default: 'development'. */
  type?: 'development' | 'ad-hoc' | 'appstore';
  /** Regenerate profile even if a valid one exists. */
  force?: boolean;
}

/** Configuration for fastlane cert (certificate management). */
export interface FastlaneCertInput {
  /** Developer portal team ID or name. */
  teamId?: string;
  /** Apple ID username. */
  username?: string;
  /** Output directory. */
  outputPath?: string;
  /** Platform: 'ios' or 'macos'. Default: 'ios'. */
  platform?: 'ios' | 'macos';
  /** Generate a new certificate even if one exists. */
  force?: boolean;
}

// ─── Default spawn ─────────────────────────────────────────────────

function defaultSpawn(
  cmd: string,
  args: string[],
  cwd?: string,
): { exitCode: number; stdout: string; stderr: string } {
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
}

// ─── Implementation ───────────────────────────────────────────────

/**
 * Create a Fastlane signing helper with injectable dependencies.
 */
export function createFastlaneSigning(spawn?: FastlaneSpawnFn) {
  const run = spawn ?? defaultSpawn;

  // ─── detectFastlane ─────────────────────────────────────────

  /**
   * Check whether fastlane is available and if the project has a Fastfile.
   *
   * Returns { available: boolean, fastfilePath?: string }.
   */
  function detectFastlane(projectRoot: string): {
    available: boolean;
    fastfilePath?: string;
    version?: string;
  } {
    // Check if fastlane CLI is installed
    const versionCheck = run('fastlane', ['--version'], projectRoot);
    const available = versionCheck.exitCode === 0;

    let version: string | undefined;
    if (available) {
      const match = versionCheck.stdout.match(/fastlane\s+([\d.]+)/i);
      version = match?.[1];
    }

    // Check for Fastfile (both ./fastlane/Fastfile and root Fastfile)
    // We don't use fs.readFileSync directly — caller can check path existence.
    // Instead, we report what fastlane itself sees.
    const fastfilePath = `${projectRoot}/fastlane/Fastfile`;

    // Try fastlane lanes to see if it can parse the Fastfile
    const lanesCheck = run('fastlane', ['lanes'], projectRoot);
    const hasValidFastfile = lanesCheck.exitCode === 0;

    return {
      available,
      version,
      fastfilePath: hasValidFastfile ? fastfilePath : undefined,
    };
  }

  // ─── runSigh ────────────────────────────────────────────────

  /**
   * Run fastlane sigh to manage provisioning profiles.
   *
   * Equivalent to: `fastlane sigh --app_identifier <bundleId> [--team_id <id>] [--force]`
   */
  function runSigh(input: FastlaneSighInput): FastlaneResult {
    const args: string[] = ['run', 'sigh'];

    args.push('--app_identifier', input.bundleId);
    args.push('--adhoc', input.type === 'ad-hoc' ? 'true' : 'false');
    args.push('--development', input.type === 'development' ? 'true' : 'false');

    if (input.teamId) {
      args.push('--team_id', input.teamId);
    }
    if (input.username) {
      args.push('--username', input.username);
    }
    if (input.outputPath) {
      args.push('--output_path', input.outputPath);
    }
    if (input.force) {
      args.push('--force');
    }

    const result = run('bundle', ['exec', 'fastlane', ...args]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout,
        error: result.stderr || 'fastlane sigh failed',
      };
    }

    return { success: true, output: result.stdout };
  }

  // ─── runCert ────────────────────────────────────────────────

  /**
   * Run fastlane cert to manage signing certificates.
   *
   * Equivalent to: `fastlane cert [--team_id <id>] [--force]`
   */
  function runCert(input: FastlaneCertInput): FastlaneResult {
    const args: string[] = ['run', 'cert'];

    if (input.teamId) {
      args.push('--team_id', input.teamId);
    }
    if (input.username) {
      args.push('--username', input.username);
    }
    if (input.outputPath) {
      args.push('--output_path', input.outputPath);
    }
    if (input.platform) {
      args.push('--platform', input.platform);
    }
    if (input.force) {
      args.push('--force');
    }

    const result = run('bundle', ['exec', 'fastlane', ...args]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout,
        error: result.stderr || 'fastlane cert failed',
      };
    }

    return { success: true, output: result.stdout };
  }

  // ─── fixSigning ─────────────────────────────────────────────

  /**
   * Attempt to fix signing by running fastlane cert + sigh in sequence.
   *
   * This is a convenience wrapper that:
   *   1. Runs cert to ensure a valid certificate exists
   *   2. Runs sigh to download/update provisioning profiles
   *
   * Returns the combined result.
   */
  async function fixSigning(
    projectRoot: string,
    bundleId: string,
    options?: { teamId?: string; username?: string; type?: FastlaneSighInput['type'] },
  ): Promise<FastlaneResult> {
    // Step 1: Ensure certificate
    const certResult = runCert({
      teamId: options?.teamId,
      username: options?.username,
      platform: 'ios',
    });

    if (!certResult.success) {
      return certResult;
    }

    // Step 2: Ensure provisioning profile
    const sighResult = runSigh({
      bundleId,
      teamId: options?.teamId,
      username: options?.username,
      type: options?.type ?? 'development',
      force: true,
    });

    return sighResult;
  }

  return {
    detectFastlane,
    runSigh,
    runCert,
    fixSigning,
  };
}
