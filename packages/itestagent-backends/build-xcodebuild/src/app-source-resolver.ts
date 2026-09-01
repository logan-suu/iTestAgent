import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TargetKind } from 'itestagent-contracts';

/**
 * AppSourceResolver — App source decision engine (task 3.1).
 *
 * B12 module split: destination mapping and build/test flows live in
 * xcodebuild-driver-support / simulator-build / physical-build /
 * xcodebuild-test-runner; this module stays source-resolution only.
 *
 * Resolves how to obtain an .app bundle for device execution given a
 * strategy + workspace root + optional user-provided path.
 *
 * Priority chain (US-6.1 AC2):
 *   1. user_specified .app/.ipa exists → user_provided
 *   2. Select one caller-proven compatible and traceable .app → existing_artifact
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
  | { kind: 'user_provided'; appPath: string; artifactType: 'app' | 'ipa' }
  | {
      kind: 'existing_artifact';
      appPath: string;
      artifactType: 'app';
      traceability: ExistingAppArtifactTraceability;
    }
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
  targetKind?: TargetKind;
  destination?: string;
  expectedBundleId?: string;
  scheme?: string;
  configuration?: string;
  existingArtifacts?: readonly ExistingAppArtifactCandidate[];
  findProjectFile?: (
    root: string,
  ) => { type: 'xcode_workspace' | 'xcode_project'; path: string } | null;
}

/** Build facts required before an existing artifact may outrank a fresh build. */
export interface ExistingAppArtifactTraceability {
  targetKind: TargetKind;
  destination: string;
  bundleId: string;
  scheme: string;
  configuration: string;
}

export interface ExistingAppArtifactCandidate extends ExistingAppArtifactTraceability {
  appPath: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Map the internal findProjectFile type to the public ProjectType.
 */
function toProjectType(raw: 'xcode_workspace' | 'xcode_project'): ProjectType {
  return raw === 'xcode_workspace' ? 'xcworkspace' : 'xcodeproj';
}

function matchingExistingArtifacts(ctx: AppSourceContext): ExistingAppArtifactCandidate[] {
  return (ctx.existingArtifacts ?? []).filter((candidate) => {
    const appPath = resolve(candidate.appPath);
    return (
      existsSync(appPath) &&
      appPath.toLowerCase().endsWith('.app') &&
      (ctx.targetKind === undefined || candidate.targetKind === ctx.targetKind) &&
      (ctx.destination === undefined || candidate.destination === ctx.destination) &&
      (ctx.expectedBundleId === undefined || candidate.bundleId === ctx.expectedBundleId) &&
      (ctx.scheme === undefined || candidate.scheme === ctx.scheme) &&
      (ctx.configuration === undefined || candidate.configuration === ctx.configuration)
    );
  });
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
      const artifactType = userPathAbs.toLowerCase().endsWith('.ipa')
        ? 'ipa'
        : userPathAbs.toLowerCase().endsWith('.app')
          ? 'app'
          : undefined;
      if (!artifactType) {
        return {
          kind: 'unresolved',
          reason: `userAppPath must be an .app directory or .ipa file: ${userPathAbs}`,
        };
      }
      return { kind: 'user_provided', appPath: userPathAbs, artifactType };
    }

    // If the user-provided path doesn't exist, fall through to
    // project detection so the consumer can decide whether to build.
    userPathFailed = true;
  }

  // ── 2. Reuse only caller-proven compatible and traceable artifacts ──
  const existingArtifacts = matchingExistingArtifacts(ctx);
  if (existingArtifacts.length === 1) {
    const { appPath, ...traceability } = existingArtifacts[0] as ExistingAppArtifactCandidate;
    return {
      kind: 'existing_artifact',
      appPath: resolve(appPath),
      artifactType: 'app',
      traceability,
    };
  }
  if (existingArtifacts.length > 1) {
    return {
      kind: 'unresolved',
      reason: `Multiple compatible existing application artifacts were found (${existingArtifacts.length}); select one explicitly or build a fresh artifact.`,
    };
  }

  // ── 3. Detect project file (.xcworkspace / .xcodeproj) ────────
  const projectFile = ctx.findProjectFile?.(absRoot);
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
