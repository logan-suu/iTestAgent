import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_SOURCE_STRATEGIES, resolveAppSource } from '../src/app-source-resolver.js';
import type {
  AppSourceContext,
  AppSourceResolution,
  AppSourceStrategy,
} from '../src/app-source-resolver.js';

// ─── Helpers ─────────────────────────────────────────────────────

/** Track temp directories to clean up after all tests. */
const tempDirs: string[] = [];

/** Create a temp directory and register it for cleanup. */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'itestagent-test-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a minimal .app bundle structure.
 * Returns the path to the .app directory.
 */
function createFakeAppBundle(baseDir: string, name: string): string {
  const appDir = join(baseDir, `${name}.app`);
  mkdirSync(appDir, { recursive: true });
  // Create Info.plist marker so it looks like a real app bundle
  writeFileSync(join(appDir, 'Info.plist'), '<plist></plist>');
  return appDir;
}

/**
 * Create a fake .xcworkspace directory.
 */
function createFakeWorkspace(baseDir: string, name: string): string {
  const wsDir = join(baseDir, `${name}.xcworkspace`);
  mkdirSync(wsDir, { recursive: true });
  writeFileSync(join(wsDir, 'contents.xcworkspacedata'), '<?xml version="1.0"?>');
  return wsDir;
}

/**
 * Create a fake .xcodeproj directory.
 */
function createFakeXcodeProj(baseDir: string, name: string): string {
  const projDir = join(baseDir, `${name}.xcodeproj`);
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, 'project.pbxproj'), '// stub');
  return projDir;
}

// ─── Cleanup ─────────────────────────────────────────────────────

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
});

// ─── Tests ───────────────────────────────────────────────────────

describe('APP_SOURCE_STRATEGIES', () => {
  it('exports the three strategy constants', () => {
    expect(APP_SOURCE_STRATEGIES).toEqual([
      'auto_from_workspace',
      'user_specified',
      'existing_artifact',
    ]);
  });
});

describe('resolveAppSource - user_specified', () => {
  it('returns user_provided when the user specified path exists', () => {
    const tmp = makeTempDir();
    const appPath = createFakeAppBundle(tmp, 'MyApp');

    const ctx: AppSourceContext = {
      strategy: 'user_specified' as AppSourceStrategy,
      workspaceRoot: tmp,
      userAppPath: appPath,
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('user_provided');
    if (result.kind === 'user_provided') {
      expect(result.appPath).toBe(appPath);
    }
  });

  it('falls through when userAppPath does not exist and no project is found', () => {
    const tmp = makeTempDir();
    const nonExistent = join(tmp, 'nope.app');

    const ctx: AppSourceContext = {
      strategy: 'user_specified' as AppSourceStrategy,
      workspaceRoot: tmp,
      userAppPath: nonExistent,
    };

    const result = resolveAppSource(ctx);
    // Since user path doesn't exist, no build/ artifacts, no project file → unresolved
    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.reason).toContain('userAppPath does not exist');
    }
  });
});

describe('resolveAppSource - existing_artifact', () => {
  it('finds .app in workspace build/ directory', () => {
    const tmp = makeTempDir();
    const buildDir = join(tmp, 'build');
    mkdirSync(buildDir, { recursive: true });
    const appPath = createFakeAppBundle(buildDir, 'MyApp');

    const ctx: AppSourceContext = {
      strategy: 'existing_artifact' as AppSourceStrategy,
      workspaceRoot: tmp,
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('existing_artifact');
    if (result.kind === 'existing_artifact') {
      expect(result.appPath).toBe(appPath);
    }
  });

  it('returns unresolved when no build directory exists', () => {
    const tmp = makeTempDir();

    const ctx: AppSourceContext = {
      strategy: 'existing_artifact' as AppSourceStrategy,
      workspaceRoot: tmp,
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('unresolved');
  });

  it('returns unresolved when build dir exists but has no .app files', () => {
    const tmp = makeTempDir();
    const buildDir = join(tmp, 'build');
    mkdirSync(buildDir, { recursive: true });
    // No .app inside

    const ctx: AppSourceContext = {
      strategy: 'existing_artifact' as AppSourceStrategy,
      workspaceRoot: tmp,
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('unresolved');
  });
});

describe('resolveAppSource - auto_from_workspace', () => {
  it('detects .xcworkspace and returns build_required with projectType xcworkspace', () => {
    const tmp = makeTempDir();
    createFakeWorkspace(tmp, 'MyProject');

    const ctx: AppSourceContext = {
      strategy: 'auto_from_workspace' as AppSourceStrategy,
      workspaceRoot: tmp,
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('build_required');
    if (result.kind === 'build_required') {
      expect(result.projectType).toBe('xcworkspace');
      expect(result.workspacePath).toBe(tmp);
    }
  });

  it('detects .xcodeproj and returns build_required with projectType xcodeproj', () => {
    const tmp = makeTempDir();
    createFakeXcodeProj(tmp, 'MyProject');

    const ctx: AppSourceContext = {
      strategy: 'auto_from_workspace' as AppSourceStrategy,
      workspaceRoot: tmp,
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('build_required');
    if (result.kind === 'build_required') {
      expect(result.projectType).toBe('xcodeproj');
      expect(result.workspacePath).toBe(tmp);
    }
  });

  it('prefers .xcworkspace over .xcodeproj when both exist', () => {
    const tmp = makeTempDir();
    createFakeWorkspace(tmp, 'MyProject');
    createFakeXcodeProj(tmp, 'MyProject');

    const ctx: AppSourceContext = {
      strategy: 'auto_from_workspace' as AppSourceStrategy,
      workspaceRoot: tmp,
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('build_required');
    if (result.kind === 'build_required') {
      expect(result.projectType).toBe('xcworkspace');
    }
  });

  it('returns unresolved when no project file found', () => {
    const tmp = makeTempDir();
    // No .xcworkspace, no .xcodeproj

    const ctx: AppSourceContext = {
      strategy: 'auto_from_workspace' as AppSourceStrategy,
      workspaceRoot: tmp,
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.reason).toContain('No .xcworkspace or .xcodeproj found');
    }
  });
});

describe('resolveAppSource - edge cases', () => {
  it('handles empty workspaceRoot gracefully', () => {
    const ctx: AppSourceContext = {
      strategy: 'auto_from_workspace' as AppSourceStrategy,
      workspaceRoot: '',
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.reason).toContain('empty');
    }
  });

  it('handles non-existent workspaceRoot gracefully', () => {
    const ctx: AppSourceContext = {
      strategy: 'auto_from_workspace' as AppSourceStrategy,
      workspaceRoot: '/tmp/definitely-does-not-exist-12345',
    };

    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.reason).toContain('does not exist');
    }
  });
});

describe('resolveAppSource - priority chain (AC2)', () => {
  it('prioritizes user path over auto workspace detection', () => {
    const tmp = makeTempDir();
    createFakeWorkspace(tmp, 'MyProject');
    const appPath = createFakeAppBundle(tmp, 'CustomApp');

    const ctx: AppSourceContext = {
      strategy: 'user_specified' as AppSourceStrategy,
      workspaceRoot: tmp,
      userAppPath: appPath,
    };

    // Even though workspace has a project file, user-provided path wins
    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('user_provided');
  });

  it('falls through user_specified missing → project detection → build_required', () => {
    const tmp = makeTempDir();
    createFakeWorkspace(tmp, 'MyProject');
    const nonExistent = join(tmp, 'does-not-exist.app');

    const ctx: AppSourceContext = {
      strategy: 'user_specified' as AppSourceStrategy,
      workspaceRoot: tmp,
      userAppPath: nonExistent,
    };

    // user path doesn't exist, but workspace has a project → build_required
    const result = resolveAppSource(ctx);
    expect(result.kind).toBe('build_required');
    if (result.kind === 'build_required') {
      expect(result.projectType).toBe('xcworkspace');
    }
  });
});
