import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * xcodebuild CLI wrapper — runs xcodebuild commands and parses their output.
 *
 * This is the "deterministic facts" layer: all data comes from Apple's
 * official xcodebuild tool. We do NOT parse pbxproj directly for these
 * calls — that's handled by pbxproj-parser.ts for the target graph.
 *
 * Reference: tech selection document — xcodebuild -list/-showBuildSettings is mandatory
 */

// ─── Errors ────────────────────────────────────────────────────

/** xcodebuild not found or returned an error. */
export class XcodebuildError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'XcodebuildError';
  }
}

// ─── Types ─────────────────────────────────────────────────────

/** Parsed output from `xcodebuild -list -json`. */
export interface XcodebuildListJson {
  project: {
    name: string;
    schemes: string[];
    configurations: string[];
    targets: string[];
  };
}

/** Parsed output from `xcodebuild -list` (non-JSON text fallback). */
export interface XcodebuildListText {
  schemes: string[];
  configurations: string[];
  targets: string[];
}

/** Parsed output from `xcodebuild -showBuildSettings`. */
export interface XcodebuildBuildSettings {
  /** Raw key=value map from xcodebuild output. */
  settings: Record<string, string>;
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Find the .xcodeproj or .xcworkspace in a directory.
 * Returns { type, path } or null if neither found.
 */
export function findProjectFile(root: string): {
  type: 'xcode_workspace' | 'xcode_project';
  path: string;
} | null {
  // Prefer workspace over project (common case)
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }

  const workspace = entries.find((e: string) => e.endsWith('.xcworkspace'));
  if (workspace) {
    return {
      type: 'xcode_workspace',
      path: resolve(root, workspace),
    };
  }

  const project = entries.find((e: string) => e.endsWith('.xcodeproj'));
  if (project) {
    return {
      type: 'xcode_project',
      path: resolve(root, project),
    };
  }

  return null;
}

/**
 * Run a command and collect stdout + stderr.
 */
function runCommand(
  cmd: string,
  args: string[],
  cwd?: string,
): { exitCode: number; stdout: string; stderr: string } {
  return spawnSyncImpl(cmd, args, cwd);
}

// ─── Parse helpers ─────────────────────────────────────────────

/**
 * Parse `xcodebuild -list` text output (non-JSON fallback for older Xcode).
 *
 * Format:
 *   Information about project "MyApp":
 *       Targets:
 *           MyApp
 *           MyAppTests
 *       Build Configurations:
 *           Debug
 *           Release
 *       If no build configuration is specified...
 *       Schemes:
 *           MyApp
 */
function parseListText(stdout: string): XcodebuildListText {
  const schemes: string[] = [];
  const configurations: string[] = [];
  const targets: string[] = [];

  // Lines that are xcodebuild informational messages, not actual entries
  const informPatterns = [/^If no build configuration/, /^$/];

  let section: 'targets' | 'configurations' | 'schemes' | null = null;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('Targets:') || trimmed === 'Targets:') {
      section = 'targets';
      continue;
    }
    if (trimmed.startsWith('Build Configurations:')) {
      section = 'configurations';
      continue;
    }
    if (trimmed.startsWith('Schemes:')) {
      section = 'schemes';
      continue;
    }

    // Section boundary: blank line or next section header
    if (trimmed === '' || trimmed.includes(':')) {
      if (trimmed === '') {
        section = null;
      }
      continue;
    }

    // Skip informational lines that aren't real entries
    if (informPatterns.some((p) => p.test(trimmed))) continue;

    // Collect entries in the current section
    if (section === 'targets') targets.push(trimmed);
    else if (section === 'configurations') configurations.push(trimmed);
    else if (section === 'schemes') schemes.push(trimmed);
  }

  return { schemes, configurations, targets };
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Run `xcodebuild -list -json` and return parsed output.
 *
 * Falls back to `xcodebuild -list` (text parsing) if -json is not supported
 * (some older Xcode versions don't support the -json flag).
 *
 * Throws XcodebuildError if xcodebuild is not available or the command fails.
 */
export function runList(root: string): {
  json: XcodebuildListJson | null;
  text: XcodebuildListText;
} {
  // Try JSON output first (Xcode 9+)
  const jsonResult = runCommand('xcodebuild', ['-list', '-json'], root);

  if (jsonResult.exitCode === 0 && jsonResult.stdout) {
    try {
      const parsed = JSON.parse(jsonResult.stdout) as XcodebuildListJson;
      // Validate structure
      if (parsed.project && Array.isArray(parsed.project.schemes)) {
        return { json: parsed, text: parseListText('') };
      }
    } catch {
      // JSON parse failed — fall through to text parsing
    }
  }

  // Fallback: plain text output
  const textResult = runCommand('xcodebuild', ['-list'], root);

  if (textResult.exitCode !== 0) {
    throw new XcodebuildError(
      `xcodebuild -list failed in ${root}: ${textResult.stderr}`,
      textResult.exitCode,
      textResult.stderr,
    );
  }

  return { json: null, text: parseListText(textResult.stdout) };
}

/**
 * Run `xcodebuild -showBuildSettings` for a specific target and configuration.
 *
 * Throws XcodebuildError if the command fails.
 */
export function runShowBuildSettings(
  root: string,
  target: string,
  configuration?: string,
): XcodebuildBuildSettings {
  const args: string[] = ['-showBuildSettings'];

  // If root is a .xcworkspace, use -workspace; otherwise use -project
  const projectFile = findProjectFile(root);
  if (projectFile) {
    if (projectFile.type === 'xcode_workspace') {
      args.push('-workspace', projectFile.path);
    } else {
      args.push('-project', projectFile.path);
    }
  }

  args.push('-target', target);

  if (configuration) {
    args.push('-configuration', configuration);
  }

  const result = runCommand('xcodebuild', args, root);

  if (result.exitCode !== 0) {
    throw new XcodebuildError(
      `xcodebuild -showBuildSettings failed for target "${target}": ${result.stderr}`,
      result.exitCode,
      result.stderr,
    );
  }

  // Parse KEY = VALUE format
  const settings: Record<string, string> = {};
  for (const line of result.stdout.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.substring(0, eqIdx).trim();
    const value = line.substring(eqIdx + 1).trim();

    if (key) {
      settings[key] = value;
    }
  }

  return { settings };
}

/**
 * Direct wrapper for Bun.spawnSync — exposed for testing (dependency injection).
 * Default implementation uses the real xcodebuild CLI.
 *
 * In tests, this can be replaced with a mock function.
 */
export type SpawnSyncFn = (
  cmd: string,
  args: string[],
  cwd?: string,
) => { exitCode: number; stdout: string; stderr: string };

export let spawnSyncImpl: SpawnSyncFn = (cmd, args, cwd) => {
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

/**
 * Override the spawn implementation (for testing).
 * Call with undefined to reset to default.
 */
export function overrideSpawnSync(fn: SpawnSyncFn | undefined): void {
  if (fn) {
    spawnSyncImpl = fn;
  } else {
    spawnSyncImpl = (cmd, args, cwd) => {
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
  }
}
