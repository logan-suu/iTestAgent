import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findProjectFile } from 'itestagent-backends-analyzer-xcodeproj';

/**
 * AppSourceResolver — App source decision engine (task 3.1).
 *
 * Resolves how to obtain an .app bundle for device execution given a
 * strategy + workspace root + optional user-provided path.
 *
 * Priority chain (US-6.1 AC2):
 *   1. user_specified path exists → user_provided
 *   2. Scan workspace build/ for .app bundles → existing_artifact
 *   3. findProjectFile() detects .xcworkspace / .xcodeproj → build_required
 *   4. Nothing found → unresolved
 *
 * This is a pure, synchronous function — no side effects beyond
 * filesystem stat calls.
 *
 * @see AGENTS.md §3: BuildDriver interface is the consumer.
 * @see US-6.1 AC1-AC5 for acceptance criteria.
 */

// ─── Constants ───────────────────────────────────────────────────

/**
 * Supported AppSource strategies.
 */
export const APP_SOURCE_STRATEGIES = [
  'auto_from_workspace',
  'user_specified',
  'existing_artifact',
] as const;

/** Discriminated union of known strategies. */
export type AppSourceStrategy = (typeof APP_SOURCE_STRATEGIES)[number];

/** Project file type as exposed by the resolver. */
export type ProjectType = 'xcworkspace' | 'xcodeproj';

// ─── Resolution discriminated union ──────────────────────────────

/**
 * Tagged union representing the result of app source resolution.
 *
 * - `user_provided`: caller passed an explicit path and it exists.
 * - `existing_artifact`: a pre-built .app was found in the workspace build dir.
 * - `build_required`: a project file was detected; the caller must build.
 * - `unresolved`: nothing matched — the caller must surface this to the user.
 */
export type AppSourceResolution =
  | { kind: 'user_provided'; appPath: string }
  | { kind: 'existing_artifact'; appPath: string }
  | { kind: 'build_required'; workspacePath: string; projectType: ProjectType }
  | { kind: 'unresolved'; reason: string };

// ─── Input context ───────────────────────────────────────────────

/**
 * Input data for resolving the app source.
 *
 * @param strategy   — how to locate the app (auto / user / existing-artifact).
 * @param workspaceRoot — absolute path to the iOS project root.
 * @param userAppPath   — (optional) path explicitly provided by the user.
 */
export interface AppSourceContext {
  strategy: AppSourceStrategy;
  workspaceRoot: string;
  userAppPath?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Map the internal findProjectFile type to the public ProjectType.
 */
function toProjectType(raw: 'xcode_workspace' | 'xcode_project'): ProjectType {
  return raw === 'xcode_workspace' ? 'xcworkspace' : 'xcodeproj';
}

/**
 * Recursively search a directory (shallow-first) for the first `.app` bundle.
 * Returns the absolute path or null if none found.
 */
function findAppBundle(root: string): string | null {
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        return join(root, entry.name);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Scan the workspace build/ directory for an existing .app bundle.
 */
function scanBuildDir(workspaceRoot: string): string | null {
  const buildDir = join(workspaceRoot, 'build');
  if (!existsSync(buildDir)) return null;
  return findAppBundle(buildDir);
}

// ─── Main resolver ───────────────────────────────────────────────

/**
 * Determine how to obtain the .app bundle for the given context.
 *
 * Pure function — no I/O beyond `existsSync` / `readdirSync` stat calls.
 *
 * @example
 * ```ts
 * const result = resolveAppSource({
 *   strategy: 'auto_from_workspace',
 *   workspaceRoot: '/path/to/MyApp',
 * });
 * // → { kind: 'build_required', workspacePath: '...', projectType: 'xcworkspace' }
 * ```
 */
export function resolveAppSource(ctx: AppSourceContext): AppSourceResolution {
  // ── 0. Guard: empty or non-existent workspaceRoot ──────────────
  if (!ctx.workspaceRoot || ctx.workspaceRoot.trim().length === 0) {
    return { kind: 'unresolved', reason: 'workspaceRoot is empty or undefined' };
  }

  const absRoot = resolve(ctx.workspaceRoot);

  if (!existsSync(absRoot)) {
    return {
      kind: 'unresolved',
      reason: `workspaceRoot does not exist: ${absRoot}`,
    };
  }

  // ── 1. user_specified — explicit user path wins (AC2) ─────────
  let userPathFailed = false;
  let userPathAbs = '';

  if (ctx.strategy === 'user_specified' && ctx.userAppPath) {
    userPathAbs = resolve(ctx.userAppPath);

    if (existsSync(userPathAbs)) {
      return { kind: 'user_provided', appPath: userPathAbs };
    }

    // If the user-provided path doesn't exist, fall through to
    // project detection so the consumer can decide whether to build.
    userPathFailed = true;
  }

  // ── 2. Scan build/ directory for .app artifacts ───────────────
  const foundApp = scanBuildDir(absRoot);
  if (foundApp) {
    return { kind: 'existing_artifact', appPath: foundApp };
  }

  // ── 3. Detect project file (.xcworkspace / .xcodeproj) ────────
  const projectFile = findProjectFile(absRoot);
  if (projectFile) {
    return {
      kind: 'build_required',
      workspacePath: absRoot,
      projectType: toProjectType(projectFile.type),
    };
  }

  // ── 4. Nothing found — escalate to consumer (AC4) ─────────────
  const reasons: string[] = [];
  if (userPathFailed) {
    reasons.push(`userAppPath does not exist: ${userPathAbs}`);
  }
  reasons.push(
    `No .xcworkspace or .xcodeproj found in ${absRoot}. Ensure you are in an Xcode project directory and that a project file exists (or provide an explicit app path via userAppPath).`,
  );

  return { kind: 'unresolved', reason: reasons.join(' ') };
}
