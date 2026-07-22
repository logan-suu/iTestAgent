/**
 * XcodebuildBuildDriver — BuildDriver interface implementation using xcodebuild + xcbeautify.
 *
 * Implements the 6-method BuildDriver contract (architecture §5.3):
 *   doctor / listSchemes / showBuildSettings / build / test / archive
 *
 * archive() is a stub — deferred to a future task.
 *
 * Dependencies are injectable for testability:
 *   spawnSync  — for synchronous commands (doctor, listSchemes, showBuildSettings)
 *   spawnAsync — for asynchronous commands (build)
 *   beautify   — pipe output through xcbeautify
 *
 * AGENTS.md R2: Uses xcodebuild (Apple official), does not re-implement.
 * AGENTS.md R12: All code/comments in English.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join as pathJoin } from 'node:path';

import { findProjectFile as defaultFindProjectFile } from 'itestagent-backends-analyzer-xcodeproj';
import type {
  ArchiveInput,
  ArchiveResult,
  BuildDoctorResult,
  BuildDriver,
  BuildInput,
  BuildResult,
  BuildSettings,
  BuildSettingsInput,
  SchemeInfo,
  TestInput,
  TestResult,
} from 'itestagent-contracts';
import { createDevicectlOps } from './devicectl-ops.js';
import type { DevicectlDeps, DevicectlOps } from './devicectl-ops.js';
import { diagnoseSigningError } from './signing-diagnostics.js';
import type { SigningDiagnostic } from './signing-diagnostics.js';

// ─── Types ────────────────────────────────────────────────────────

/** Result of a synchronous subprocess call. */
export interface SyncSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Result of an asynchronous subprocess call. */
export interface AsyncSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Synchronous spawn function signature (matches Bun.spawnSync). */
export type SpawnSyncFn = (cmd: string, args: string[], cwd?: string) => SyncSpawnResult;

/** Asynchronous spawn function signature. */
export type SpawnAsyncFn = (cmd: string, args: string[], cwd?: string) => Promise<AsyncSpawnResult>;

/** xcbeautify pipe-through function. */
export type BeautifyFn = (rawOutput: string, cwd?: string) => Promise<string>;

export type FindProjectFileFn = (
  root: string,
) => { type: 'xcode_workspace' | 'xcode_project'; path: string } | null;

export type FindAppPathFn = (
  derivedDataPath: string,
  scheme: string,
  configuration: string,
) => string | undefined;

/** Injectable dependencies for XcodebuildBuildDriver. */
export interface XcodebuildDriverDeps {
  spawnSync: SpawnSyncFn;
  spawnAsync: SpawnAsyncFn;
  beautify: BeautifyFn;
  findProjectFile: FindProjectFileFn;
  findAppPath: FindAppPathFn;
  /** Devicectl operations for install/launch/terminate (US-6.2 AC1/AC4). */
  devicectlOps: DevicectlOps;
  /** Signing error diagnosis function (US-6.2 AC3). */
  diagnoseSigning: (output: string) => SigningDiagnostic | null;
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
  } catch (err) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: `command not found: ${cmd}`,
    };
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
  } catch (err) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: `command not found: ${cmd}`,
    };
  }
};

/**
 * Default xcbeautify pipe-through.
 * Attempts to pipe text through xcbeautify; falls back to raw output.
 */
async function defaultBeautify(rawOutput: string, _cwd?: string): Promise<string> {
  if (!rawOutput) return '';
  try {
    const proc = Bun.spawn(['xcbeautify'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    proc.stdin.write(rawOutput);
    proc.stdin.end();
    const result = await new Response(proc.stdout).text();
    return result.trim();
  } catch {
    return rawOutput;
  }
}

// ─── Implementation ───────────────────────────────────────────────

/**
 * Create an XcodebuildBuildDriver instance.
 *
 * @param deps - Injectable dependencies. Uses real spawn / xcbeautify by default.
 */
export function createXcodebuildBuildDriver(deps?: Partial<XcodebuildDriverDeps>): BuildDriver {
  const spawnSync = deps?.spawnSync ?? defaultSpawnSync;
  const spawnAsync = deps?.spawnAsync ?? defaultSpawnAsync;
  const beautify = deps?.beautify ?? defaultBeautify;
  const resolveProjectFile = deps?.findProjectFile ?? defaultFindProjectFile;
  const findApp = deps?.findAppPath ?? findAppInDerivedData;

  // Devicectl ops: use same spawn fns for consistency; tests can inject their own via deps.
  const devicectlOps = deps?.devicectlOps ?? createDevicectlOps({ spawnSync, spawnAsync });

  // Signing diagnosis: pure function, default no-op replacement in tests.
  const diagnoseSigning = deps?.diagnoseSigning ?? diagnoseSigningError;

  // ─── doctor ──────────────────────────────────────────────────

  async function doctor(): Promise<BuildDoctorResult> {
    const xcodeVersionResult = spawnSync('xcodebuild', ['-version']);
    const xcrunResult = spawnSync('xcrun', ['xcode-select', '-p']);

    const installed = xcodeVersionResult.exitCode === 0;
    const cltInstalled = xcrunResult.exitCode === 0;

    let version: string | undefined;
    if (installed && xcodeVersionResult.stdout) {
      // First line is "Xcode X.Y" or "Xcode X.Y.Z"
      const firstLine = xcodeVersionResult.stdout.split('\n')[0];
      const match = firstLine?.match(/Xcode\s+([\d.]+)/);
      version = match ? match[1] : undefined;
    }

    const issues: string[] = [];
    const suggestions: string[] = [];

    if (!installed) {
      issues.push('xcodebuild not found on PATH');
      suggestions.push('Install Xcode and Command Line Tools: xcode-select --install');
    }
    if (!cltInstalled) {
      issues.push('Command Line Tools path not found');
      suggestions.push('Run xcode-select --install or check xcode-select -p');
    }

    return {
      xcodeInstalled: installed,
      xcodeVersion: version,
      commandLineTools: cltInstalled,
      signingIdentities: [], // Stub — deferred to signing tool (fastlane path)
      issues,
      suggestions,
    };
  }

  // ─── listSchemes ─────────────────────────────────────────────

  async function listSchemes(root: string): Promise<SchemeInfo[]> {
    const result = spawnSync('xcodebuild', ['-list', '-json'], root);

    if (result.exitCode !== 0) {
      throw new Error(
        `xcodebuild -list -json failed in ${root}: ${result.stderr || 'unknown error'}`,
      );
    }

    let parsed: { project?: { schemes?: string[]; configurations?: string[] } };
    try {
      parsed = JSON.parse(result.stdout) as typeof parsed;
    } catch {
      throw new Error(
        `Failed to parse xcodebuild -list -json output in ${root}: ${result.stdout.slice(0, 200)}`,
      );
    }

    const schemes: string[] = parsed?.project?.schemes ?? [];
    const configurations: string[] = parsed?.project?.configurations ?? [];

    return schemes.map((name) => ({
      name,
      type: classifyScheme(name),
      buildConfigurations: configurations,
    }));
  }

  // ─── showBuildSettings ───────────────────────────────────────

  async function showBuildSettings(input: BuildSettingsInput): Promise<BuildSettings> {
    const { root, scheme, configuration } = input;
    const projectFile = resolveProjectFile(root);

    const args: string[] = ['-showBuildSettings', '-scheme', scheme];

    if (projectFile) {
      if (projectFile.type === 'xcode_workspace') {
        args.push('-workspace', projectFile.path);
      } else {
        args.push('-project', projectFile.path);
      }
    }

    if (configuration) {
      args.push('-configuration', configuration);
    }

    const result = spawnSync('xcodebuild', args, root);

    if (result.exitCode !== 0) {
      throw new Error(
        `xcodebuild -showBuildSettings failed for scheme "${scheme}" in ${root}: ${result.stderr || 'unknown error'}`,
      );
    }

    const settings: Record<string, unknown> = {};
    for (const line of result.stdout.split('\n')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;

      const key = line.substring(0, eqIdx).trim();
      const value = line.substring(eqIdx + 1).trim();

      if (key) {
        settings[key] = value;
      }
    }

    return {
      settings,
      derivedDataPath: settings.BUILD_DIR as string | undefined,
      builtProductsDir: settings.BUILT_PRODUCTS_DIR as string | undefined,
    };
  }

  // ─── build ───────────────────────────────────────────────────

  async function build(input: BuildInput): Promise<BuildResult> {
    const {
      root,
      scheme,
      configuration = 'Debug',
      deviceId,
      derivedDataPath,
      extraArgs = [],
    } = input;

    const startMs = Date.now();

    const projectFile = resolveProjectFile(root);
    if (!projectFile) {
      const log = 'No .xcworkspace or .xcodeproj found in project root';
      return { success: false, log, durationMs: Date.now() - startMs };
    }

    const resolvedDerivedDataPath = derivedDataPath ?? `${root}/build/derivedData`;

    const args: string[] = [
      projectFile.type === 'xcode_workspace' ? '-workspace' : '-project',
      projectFile.path,
      '-scheme',
      scheme,
      '-configuration',
      configuration,
      '-destination',
      `platform=iOS,id=${deviceId}`,
      '-derivedDataPath',
      resolvedDerivedDataPath,
      'build',
      ...extraArgs,
    ];

    const result = await spawnAsync('xcodebuild', args, root);
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const log = await beautify(rawOutput, root);
    const durationMs = Date.now() - startMs;

    if (result.exitCode !== 0) {
      // US-6.2 AC3: diagnose signing errors from xcodebuild output
      const signingDiag = diagnoseSigning(rawOutput);
      if (signingDiag) {
        const diagnosticLog = [
          log,
          '',
          '═══ SIGNING DIAGNOSTIC ═══',
          `Reason: ${signingDiag.reason}`,
          '',
          'Fix guidance:',
          ...signingDiag.fixGuide.map((g, i) => `  ${i + 1}. ${g}`),
        ].join('\n');
        return { success: false, log: diagnosticLog, durationMs };
      }

      return { success: false, log, durationMs };
    }

    // Find .app path in DerivedData
    const appPath = findApp(resolvedDerivedDataPath, scheme, configuration);

    // US-6.2 AC1: install built .app to device via devicectl
    let installed = false;
    let installError: string | undefined;

    if (appPath) {
      const installResult = await devicectlOps.installApp(deviceId, appPath);
      if (installResult.success) {
        installed = true;
      } else {
        installError = installResult.error;
      }
    }

    const buildResult: BuildResult & {
      installed?: boolean;
      installError?: string;
    } = {
      success: true,
      appPath,
      log,
      durationMs,
      installed,
    };

    if (installError) {
      buildResult.installError = installError;
    }

    return buildResult;
  }

  // ─── test ───────────────────────────────────────────────────

  async function test(input: TestInput): Promise<TestResult> {
    const { root, scheme, deviceId, testPlan, only, skip } = input;

    const startMs = Date.now();

    const projectFile = resolveProjectFile(root);
    if (!projectFile) {
      const log = 'No .xcworkspace or .xcodeproj found in project root';
      return {
        success: false,
        totalTests: 0,
        passed: 0,
        failed: 0,
        log,
        durationMs: Date.now() - startMs,
      };
    }

    const resolvedDerivedDataPath = `${root}/build/derivedData`;
    const xcresultPath = pathJoin(
      resolvedDerivedDataPath,
      'Logs',
      'Test',
      `Test-${scheme}.xcresult`,
    );

    const args: string[] = [
      projectFile.type === 'xcode_workspace' ? '-workspace' : '-project',
      projectFile.path,
      '-scheme',
      scheme,
      '-destination',
      `platform=iOS,id=${deviceId}`,
      '-derivedDataPath',
      resolvedDerivedDataPath,
      '-resultBundlePath',
      xcresultPath,
    ];

    if (testPlan) {
      args.push('-testPlan', testPlan);
    }
    if (only && only.length > 0) {
      for (const test of only) {
        args.push('-only-testing', test);
      }
    }
    if (skip && skip.length > 0) {
      for (const test of skip) {
        args.push('-skip-testing', test);
      }
    }

    args.push('test');

    const result = await spawnAsync('xcodebuild', args, root);
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const log = await beautify(rawOutput, root);
    const durationMs = Date.now() - startMs;

    const counts = parseTestCounts(rawOutput);

    // R5: only return xcresultPath if the file actually exists on disk
    const xcresultExists = existsSync(xcresultPath);

    return {
      success: result.exitCode === 0,
      totalTests: counts.total,
      passed: counts.passed,
      failed: counts.failed,
      xcresultPath: xcresultExists ? xcresultPath : undefined,
      log,
      durationMs,
    };
  }

  // ─── archive (stub) ──────────────────────────────────────────

  async function archive(_input: ArchiveInput): Promise<ArchiveResult> {
    throw new Error('archive() not implemented');
  }

  // ─── Return interface ────────────────────────────────────────

  return {
    doctor,
    listSchemes,
    showBuildSettings,
    build,
    test,
    archive,
  };
}

/**
 * Parse basic test counts from xcodebuild test output.
 *
 * xcodebuild prints a summary line after all tests:
 *   "Executed 10 tests, with 2 failures (0 unexpected) in 5.678 (6.000) seconds"
 *   "Executed 1 test, with 0 failures (0 unexpected) in 0.123 (0.150) seconds"
 *
 * Returns { total: 0, passed: 0, failed: 0 } when no match found (R5: no guessing).
 */
function parseTestCounts(output: string): { total: number; passed: number; failed: number } {
  const match = output.match(/Executed\s+(\d+)\s+tests?,\s+with\s+(\d+)\s+failures?/);
  if (!match) {
    return { total: 0, passed: 0, failed: 0 };
  }
  const total = Number.parseInt(match[1] ?? '0', 10);
  const failed = Number.parseInt(match[2] ?? '0', 10);
  return { total, passed: total - failed, failed };
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Classify a scheme name into app / test / other.
 *
 * Heuristic: schemes ending in "Tests" or "UITests" are test schemes;
 * schemes ending in "Tests" or containing "Test" are test schemes.
 */
function classifyScheme(name: string): SchemeInfo['type'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('tests') || lower.includes('.xctest')) {
    return 'test';
  }
  return 'app';
}

/**
 * Find the built .app in DerivedData for a given scheme and configuration.
 *
 * DerivedData layout:
 *   DerivedData/<ProjectName>-<hash>/Build/Products/<Config>-<platform>/<Scheme>.app
 *
 * This scans for .app bundles matching the scheme name.
 */
function findAppInDerivedData(
  derivedDataPath: string,
  scheme: string,
  configuration: string,
): string | undefined {
  try {
    // Step 1: Find the project build directory inside DerivedData
    const entries = readdirSync(derivedDataPath);
    for (const entry of entries) {
      const projectBuildDir = pathJoin(derivedDataPath, entry);
      const productsDir = pathJoin(projectBuildDir, 'Build', 'Products');

      // Step 2: Look for <Config>-iphoneos or <Config>-iphonesimulator
      const platforms = [`${configuration}-iphoneos`, `${configuration}-iphonesimulator`];
      for (const platform of platforms) {
        const platformDir = pathJoin(productsDir, platform);
        try {
          const platformEntries = readdirSync(platformDir);
          // Step 3: Look for <Scheme>.app
          const appEntry = platformEntries.find((e) => e === `${scheme}.app`);
          if (appEntry) {
            return pathJoin(platformDir, appEntry);
          }
        } catch {
          // Directory may not exist — skip
        }
      }
    }
  } catch (err) {
    // DerivedData scan failed — non-blocking (caller continues without appPath).
    // Log as warning so the failure is not silent (R5 compliance).
    console.warn(
      `[itestagent-build] findAppInDerivedData: scan failed for ${derivedDataPath}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return undefined;
}
