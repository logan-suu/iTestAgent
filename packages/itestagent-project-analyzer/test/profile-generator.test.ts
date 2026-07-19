/**
 * profile-generator.test.ts — TDD tests for generateProjectProfile()
 *
 * Covers:
 *   - AC1: Profile contains app, features, testAssets, suggestedSmoke
 *   - AC2: Default storage path
 *   - AC3: Project-level save
 *   - AC4: Profile can be referenced (schema conformance)
 *   - R4:  Features carry evidence + confidence, never auto-finalize
 *   - R1:  app fields are deterministic from backend
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BuildSettingsQuery,
  ProjectAnalyzerBackend,
  ProjectDiscovery,
  ProjectGraph,
  ResolvedBuildSettings,
  ResourceFacts,
  ResourceScanInput,
  SourceFacts,
  SourceScanInput,
} from 'itestagent-contracts';
import {
  computeProjectHash,
  generateProjectProfile,
  loadProfile,
  saveProfile,
  saveProfileToProject,
} from '../src/index.js';

// ─── Fixture helpers ───────────────────────────────────────────────

/**
 * Create a mock ProjectAnalyzerBackend with full fixture data.
 * Simulates a realistic iOS project (MyApp with login/profile/settings VCs).
 */
function createMockBackend(): ProjectAnalyzerBackend {
  const discovery: ProjectDiscovery = {
    root: '/fake/MyApp',
    name: 'MyApp',
    type: 'xcode_workspace',
    xcworkspacePath: '/fake/MyApp/MyApp.xcworkspace',
    xcodeprojPath: '/fake/MyApp/MyApp.xcodeproj',
    schemes: ['MyApp', 'MyAppTests', 'MyAppUITests'],
    configurations: ['Debug', 'Release'],
  };

  const graph: ProjectGraph = {
    targets: [
      { name: 'MyApp', type: 'app', dependencies: [], sourceCount: 45, testCount: 0 },
      { name: 'MyAppTests', type: 'test', dependencies: ['MyApp'], sourceCount: 0, testCount: 12 },
      { name: 'MyAppUITests', type: 'test', dependencies: ['MyApp'], sourceCount: 0, testCount: 8 },
      { name: 'MyFramework', type: 'framework', dependencies: [], sourceCount: 20 },
    ],
    hasXCUITests: true,
    hasUnitTests: true,
  };

  const buildSettings: ResolvedBuildSettings = {
    bundleIdentifier: 'com.example.MyApp',
    bundleName: 'MyApp',
    deploymentTarget: '16.0',
    swiftVersion: '5.9',
    architectures: ['arm64'],
    infoPlistPath: '/fake/MyApp/Info.plist',
  };

  const sourceFacts: SourceFacts = {
    swiftFiles: 45,
    objcFiles: 3,
    viewControllers: [
      { name: 'LoginViewController', file: 'Sources/Login/LoginViewController.swift' },
      { name: 'HomeViewController', file: 'Sources/Home/HomeViewController.swift' },
      { name: 'SettingsViewController', file: 'Sources/Settings/SettingsViewController.swift' },
      { name: 'ProfileViewController', file: 'Sources/Profile/ProfileViewController.swift' },
      { name: 'PaymentViewController', file: 'Sources/Payment/PaymentViewController.swift' },
      { name: 'SearchViewController', file: 'Sources/Search/SearchViewController.swift' },
      { name: 'SomeDelegateHandler', file: 'Sources/Utils/SomeDelegateHandler.swift' },
    ],
    protocols: ['Codable', 'Equatable', 'AppViewModel'],
    storyboardRefs: ['Base.lproj/Main.storyboard', 'Base.lproj/LaunchScreen.storyboard'],
    xibRefs: ['Views/CustomCell.xib'],
  };

  const resourceFacts: ResourceFacts = {
    assetCatalogs: 2,
    fontFiles: ['Resources/Fonts/Custom.ttf'],
    localizedStrings: ['Resources/en.lproj/Localizable.strings'],
    infoPlistKeys: ['CFBundleName', 'CFBundleIdentifier', 'NSCameraUsageDescription'],
  };

  return {
    discover: async (_root: string) => ({ ...discovery }),
    graph: async (_input: ProjectDiscovery) => ({ ...graph }),
    buildSettings: async (_input: BuildSettingsQuery) => ({ ...buildSettings }),
    scanSources: async (_input: SourceScanInput) => ({ ...sourceFacts }),
    scanResources: async (_input: ResourceScanInput) => ({ ...resourceFacts }),
  };
}

/** Create a mock backend representing an empty project (no VCs, no XCUITest). */
function createEmptyMockBackend(): ProjectAnalyzerBackend {
  return {
    discover: async (_root: string) => ({
      root: '/fake/EmptyApp',
      name: 'EmptyApp',
      type: 'xcode_project',
      xcodeprojPath: '/fake/EmptyApp/EmptyApp.xcodeproj',
      schemes: ['EmptyApp'],
      configurations: ['Debug'],
    }),
    graph: async () => ({
      targets: [{ name: 'EmptyApp', type: 'app', dependencies: [], sourceCount: 1, testCount: 0 }],
      hasXCUITests: false,
      hasUnitTests: false,
    }),
    buildSettings: async () => ({
      bundleIdentifier: 'com.example.EmptyApp',
      architectures: ['arm64'],
    }),
    scanSources: async () => ({
      swiftFiles: 1,
      objcFiles: 0,
      viewControllers: [],
      protocols: [],
      storyboardRefs: [],
      xibRefs: [],
    }),
    scanResources: async () => ({
      assetCatalogs: 1,
      fontFiles: [],
      localizedStrings: [],
      infoPlistKeys: ['CFBundleName'],
    }),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('generateProjectProfile', () => {
  let backend: ProjectAnalyzerBackend;

  beforeEach(() => {
    backend = createMockBackend();
  });

  // ── AC1: app ──────────────────────────────────────────────

  it('AC1: includes app with deterministic fields (name, bundleId, workspace, scheme)', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    expect(profile.app.name).toBe('MyApp');
    expect(profile.app.bundleId).toBe('com.example.MyApp');
    expect(profile.app.workspace).toBe('/fake/MyApp/MyApp.xcworkspace');
    expect(profile.app.project).toBe('/fake/MyApp/MyApp.xcodeproj');
    expect(profile.app.scheme).toBe('MyApp'); // First scheme as default
  });

  it('R1: app fields are deterministic — same input = same output', async () => {
    const p1 = await generateProjectProfile(backend, '/fake/MyApp');
    const p2 = await generateProjectProfile(backend, '/fake/MyApp');

    expect(p1.app.name).toBe(p2.app.name);
    expect(p1.app.bundleId).toBe(p2.app.bundleId);
    expect(p1.app.scheme).toBe(p2.app.scheme);
    expect(p1.projectHash).toBe(p2.projectHash);
  });

  // ── AC1: targets ──────────────────────────────────────────

  it('AC1: includes targets array derived from graph', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    expect(profile.targets.length).toBe(4);
    const appTarget = profile.targets.find((t) => t.type === 'app');
    expect(appTarget?.name).toBe('MyApp');
    expect(appTarget?.bundleId).toBe('com.example.MyApp');

    const testTargets = profile.targets.filter((t) => t.type === 'test');
    expect(testTargets.length).toBe(2);
  });

  // ── AC1: testAssets ───────────────────────────────────────

  it('AC1: includes testAssets with hasXCUITest, hasScheme, testTargets', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    expect(profile.testAssets.hasXCUITest).toBe(true);
    expect(profile.testAssets.hasScheme).toBe(true);
    expect(profile.testAssets.testTargets).toContain('MyAppTests');
    expect(profile.testAssets.testTargets).toContain('MyAppUITests');
  });

  it('testAssets.hasXCUITest is false when no XCUITest targets exist', async () => {
    const emptyBackend = createEmptyMockBackend();
    const profile = await generateProjectProfile(emptyBackend, '/fake/EmptyApp');

    expect(profile.testAssets.hasXCUITest).toBe(false);
    expect(profile.testAssets.hasScheme).toBe(false);
  });

  // ── AC1: features (R4 compliance) ─────────────────────────

  it('AC1 + R4: includes features from VCs with evidence and confidence', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    expect(profile.features.length).toBeGreaterThan(0);

    // Login VC should have high confidence
    const login = profile.features.find((f) => f.entry === 'LoginViewController');
    expect(login).toBeDefined();
    expect(login?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(login?.evidence.length).toBeGreaterThanOrEqual(1);
    expect(login?.evidence[0]).toContain('LoginViewController.swift');
    expect(login?.testability).toBe('xcuitest'); // hasXCUITest = true
    expect(login?.requiresAccount).toBe(true);

    // Delegate handler should have low confidence
    const delegate = profile.features.find((f) => f.entry === 'SomeDelegateHandler');
    expect(delegate).toBeDefined();
    expect(delegate?.confidence).toBeLessThanOrEqual(0.4);
  });

  it('R4: every feature has at least one evidence entry', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    for (const f of profile.features) {
      expect(f.evidence.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('R4: confidence is always between 0 and 1', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    for (const f of profile.features) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('features are sorted by confidence descending', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    for (let i = 1; i < profile.features.length; i++) {
      const prev = profile.features[i - 1]!;
      const curr = profile.features[i]!;
      expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
    }
  });

  it('empty project produces empty features', async () => {
    const emptyBackend = createEmptyMockBackend();
    const profile = await generateProjectProfile(emptyBackend, '/fake/EmptyApp');

    expect(profile.features).toEqual([]);
  });

  // ── AC1: suggestedSmoke ───────────────────────────────────

  it('AC1: includes suggestedSmoke with "launch" as universal baseline', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    expect(profile.suggestedSmoke).toContain('launch');
    expect(profile.suggestedSmoke.length).toBeGreaterThan(1);
  });

  it('suggestedSmoke includes high-confidence features', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    // Login (confidence 0.75) and Search (0.75) should be included
    expect(profile.suggestedSmoke).toContain('Login');
    expect(profile.suggestedSmoke).toContain('Search');
  });

  it('suggestedSmoke excludes low-confidence features', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    // Delegate handler has confidence 0.35, should NOT be in smoke
    expect(profile.suggestedSmoke).not.toContain('SomeDelegateHandler');
  });

  it('suggestedSmoke is capped at 8 entries', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    expect(profile.suggestedSmoke.length).toBeLessThanOrEqual(8);
  });

  // ── schemaVersion ─────────────────────────────────────────

  it('includes correct schemaVersion constant', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    expect(profile.schemaVersion).toBe('itestagent.project-profile.v1');
  });

  // ── projectHash ───────────────────────────────────────────

  it('projectHash is a 64-character hex string', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    expect(profile.projectHash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── Edge case: no app target ─────────────────────────────

  it('handles projects with no app target gracefully', async () => {
    const noAppBackend: ProjectAnalyzerBackend = {
      ...createMockBackend(),
      graph: async () => ({
        targets: [],
        hasXCUITests: false,
        hasUnitTests: false,
      }),
    };

    const profile = await generateProjectProfile(noAppBackend, '/fake/LibProject');

    expect(profile.targets).toEqual([]);
    expect(profile.app.bundleId).toBeUndefined(); // No buildSettings call without app target
  });
});

// ─── profile-io tests ──────────────────────────────────────────────

describe('profile-io (AC2, AC3, AC4)', () => {
  let tmpDir: string;
  let backend: ProjectAnalyzerBackend;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'itestagent-test-'));
    backend = createMockBackend();
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  // ── AC2: default storage path ─────────────────────────────

  it('AC2: saveProfile writes to ~/.itestagent/projects/<hash>/project-profile.json', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    // saveProfile writes to the actual home directory path
    // We verify it doesn't throw
    expect(() => saveProfile(profile)).not.toThrow();
  });

  // ── AC3: project-level save ──────────────────────────────

  it('AC3: saveProfileToProject writes to <project>/.itestagent/project-profile.json', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    const projectRoot = join(tmpDir, 'MyApp');
    saveProfileToProject(profile, projectRoot);

    const expectedPath = join(projectRoot, '.itestagent', 'project-profile.json');
    const saved = JSON.parse(readFileSync(expectedPath, 'utf-8'));

    expect(saved.schemaVersion).toBe('itestagent.project-profile.v1');
    expect(saved.app.name).toBe('MyApp');
  });

  // ── AC4: round-trip integrity ────────────────────────────

  it('AC4: profile can be saved and loaded with full integrity', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');

    // Write to a tmp directory for isolated testing
    // We test loadProfile by writing to the default location
    saveProfile(profile);

    const loaded = loadProfile(profile.projectHash);
    expect(loaded).not.toBeNull();
    expect(loaded?.schemaVersion).toBe(profile.schemaVersion);
    expect(loaded?.app.name).toBe(profile.app.name);
    expect(loaded?.app.bundleId).toBe(profile.app.bundleId);
    expect(loaded?.features.length).toBe(profile.features.length);
    expect(loaded?.suggestedSmoke).toEqual(profile.suggestedSmoke);
  });

  it('loadProfile returns null for non-existent hash', () => {
    const result = loadProfile('deadbeef'.repeat(8)); // 64-char fake hash
    expect(result).toBeNull();
  });
});

// ─── computeProjectHash tests ──────────────────────────────────────

describe('computeProjectHash', () => {
  it('returns a 64-character hex string', async () => {
    const hash = await computeProjectHash('/tmp/test-project');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for the same input', async () => {
    const h1 = await computeProjectHash('/tmp/same-path');
    const h2 = await computeProjectHash('/tmp/same-path');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different inputs', async () => {
    const h1 = await computeProjectHash('/tmp/path-a');
    const h2 = await computeProjectHash('/tmp/path-b');
    expect(h1).not.toBe(h2);
  });
});
