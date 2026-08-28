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
 *   - B10: published schemas/project-profile.schema.json exists (draft-07),
 *     mirrors the runtime Zod schema, and generated profiles conform to it
 *   - B10: profile-inference heuristic edge cases
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import {
  confidenceForViewName,
  extractKeywords,
  inferFeatures,
  inferSuggestedSmoke,
  isAccountRelated,
} from '../src/profile-inference.js';

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
      const prev = profile.features[i - 1];
      const curr = profile.features[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      if (prev && curr) {
        expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
      }
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
    saveProfileToProject(profile, projectRoot, true);

    const expectedPath = join(projectRoot, '.itestagent', 'project-profile.json');
    const saved = JSON.parse(readFileSync(expectedPath, 'utf-8'));

    expect(saved.schemaVersion).toBe('itestagent.project-profile.v1');
    expect(saved.app.name).toBe('MyApp');
  });

  // ── R7: confirmation gate ───────────────────────────────

  it('R7: saveProfileToProject throws when confirmed is omitted or false', async () => {
    const profile = await generateProjectProfile(backend, '/fake/MyApp');
    const projectRoot = join(tmpDir, 'R7-test');
    expect(() => saveProfileToProject(profile, projectRoot)).toThrow(/R7/);
    expect(() => saveProfileToProject(profile, projectRoot, false)).toThrow(/R7/);
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

// ─── published schema parity (guide §11.4: project-profile→B10) ────

describe('published schemas/project-profile.schema.json', () => {
  const SCHEMA_PATH = join(
    import.meta.dir,
    '..',
    '..',
    '..',
    'schemas',
    'project-profile.schema.json',
  );

  it('exists and is valid JSON', () => {
    expect(existsSync(SCHEMA_PATH)).toBe(true);
    expect(() => JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))).not.toThrow();
  });

  it('is a draft-07 object schema with the expected identity headers', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.$id).toBe('https://itestagent.dev/schemas/project-profile.schema.json');
    expect(schema.title).toBe('ProjectProfile');
    expect(schema.type).toBe('object');
  });

  it('top-level properties and required list mirror ProjectProfileSchema exactly', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

    // additionalProperties: false → properties must enumerate the full Zod shape
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        'app',
        'features',
        'projectHash',
        'schemaVersion',
        'suggestedSmoke',
        'targets',
        'testAssets',
      ].sort(),
    );
    expect(schema.required.sort()).toEqual(
      [
        'app',
        'features',
        'projectHash',
        'schemaVersion',
        'suggestedSmoke',
        'targets',
        'testAssets',
      ].sort(),
    );
    expect(schema.additionalProperties).toBe(false);

    expect(schema.properties.schemaVersion.const).toBe('itestagent.project-profile.v1');
    expect(schema.properties.projectHash.pattern).toBe('^[a-f0-9]{64}$');
  });

  it('definitions mirror the nested Zod schemas (Target/TestAssets/CandidateLink)', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

    expect(Object.keys(schema.definitions).sort()).toEqual([
      'CandidateLink',
      'TargetProfile',
      'TestAssetsProfile',
    ]);

    const target = schema.definitions.TargetProfile;
    expect(target.required.sort()).toEqual(['name', 'type'].sort());
    expect(target.properties.type.enum).toEqual([
      'app',
      'test',
      'extension',
      'framework',
      'watch',
      'widget',
    ]);

    const testAssets = schema.definitions.TestAssetsProfile;
    expect(testAssets.required.sort()).toEqual(['hasScheme', 'hasXCUITest'].sort());

    const link = schema.definitions.CandidateLink;
    expect(link.required.sort()).toEqual(['confidence', 'evidence', 'name'].sort());
    expect(link.properties.evidence.minItems).toBe(1);
    expect(link.properties.confidence.minimum).toBe(0);
    expect(link.properties.confidence.maximum).toBe(1);
    expect(link.properties.displayOrder.minimum).toBe(0);
    expect(link.properties.testability.enum).toEqual([
      'xcuitest',
      'device_backend',
      'mixed',
      'unknown',
    ]);
    expect(link.properties.confirmed.default).toBe(false);
    expect(link.properties.displayOrder.default).toBe(0);
    expect(link.properties.expectedOutcomes).toBeDefined();
    expect(link.properties.expectedOutcomes.items.type).toBe('string');
  });

  it('CandidateLink carries Zod defaults and expectedOutcomes (US-11.1 AC1 tier 2)', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
    const link = schema.definitions.CandidateLink;
    expect(link.properties.confirmed.default).toBe(false);
    expect(link.properties.displayOrder.default).toBe(0);
    expect(link.properties.expectedOutcomes.type).toBe('array');
  });
});

// ─── generated profile conforms to published schema shape ──────────

describe('profile generation conforms to published schema shape', () => {
  function expectFeatureConforms(f: {
    name: unknown;
    entry?: unknown;
    keywords?: unknown;
    testability?: unknown;
    requiresAccount?: unknown;
    evidence: unknown;
    confidence: unknown;
    confirmed?: unknown;
    displayOrder?: unknown;
    expectedOutcomes?: unknown;
  }): void {
    expect(typeof f.name).toBe('string');
    if (f.entry !== undefined) expect(typeof f.entry).toBe('string');
    if (f.keywords !== undefined) {
      expect(Array.isArray(f.keywords)).toBe(true);
      for (const k of f.keywords as string[]) expect(typeof k).toBe('string');
    }
    if (f.testability !== undefined) {
      expect(['xcuitest', 'device_backend', 'mixed', 'unknown']).toContain(f.testability as string);
    }
    if (f.requiresAccount !== undefined) expect(typeof f.requiresAccount).toBe('boolean');
    expect(Array.isArray(f.evidence)).toBe(true);
    expect((f.evidence as string[]).length).toBeGreaterThanOrEqual(1);
    for (const e of f.evidence as string[]) expect(typeof e).toBe('string');
    expect(typeof f.confidence).toBe('number');
    expect(f.confidence).toBeGreaterThanOrEqual(0);
    expect(f.confidence).toBeLessThanOrEqual(1);
    if (f.confirmed !== undefined) expect(typeof f.confirmed).toBe('boolean');
    if (f.displayOrder !== undefined) {
      expect(Number.isInteger(f.displayOrder)).toBe(true);
      expect(f.displayOrder).toBeGreaterThanOrEqual(0);
    }
    if (f.expectedOutcomes !== undefined) {
      expect(Array.isArray(f.expectedOutcomes)).toBe(true);
      for (const o of f.expectedOutcomes as string[]) expect(typeof o).toBe('string');
    }
  }

  it('mock-backend profile satisfies every top-level schema constraint', async () => {
    const profile = await generateProjectProfile(createMockBackend(), '/fake/MyApp');

    expect(Object.keys(profile).sort()).toEqual(
      [
        'app',
        'features',
        'projectHash',
        'schemaVersion',
        'suggestedSmoke',
        'targets',
        'testAssets',
      ].sort(),
    );
    expect(profile.schemaVersion).toBe('itestagent.project-profile.v1');
    expect(profile.projectHash).toMatch(/^[a-f0-9]{64}$/);

    for (const key of Object.keys(profile.app)) {
      expect(['name', 'bundleId', 'workspace', 'project', 'scheme']).toContain(key);
    }

    for (const t of profile.targets) {
      expect(typeof t.name).toBe('string');
      expect(['app', 'test', 'extension', 'framework', 'watch', 'widget']).toContain(t.type);
      if (t.bundleId !== undefined) expect(typeof t.bundleId).toBe('string');
    }

    expect(typeof profile.testAssets.hasXCUITest).toBe('boolean');
    expect(typeof profile.testAssets.hasScheme).toBe('boolean');
    if (profile.testAssets.testTargets !== undefined) {
      expect(Array.isArray(profile.testAssets.testTargets)).toBe(true);
    }

    for (const f of profile.features) expectFeatureConforms(f);

    expect(Array.isArray(profile.suggestedSmoke)).toBe(true);
    for (const s of profile.suggestedSmoke) expect(typeof s).toBe('string');
  });

  it('empty-project profile also conforms (empty arrays, no extra keys)', async () => {
    const profile = await generateProjectProfile(createEmptyMockBackend(), '/fake/EmptyApp');

    expect(Object.keys(profile).sort()).toEqual(
      [
        'app',
        'features',
        'projectHash',
        'schemaVersion',
        'suggestedSmoke',
        'targets',
        'testAssets',
      ].sort(),
    );
    expect(profile.features).toEqual([]);
    for (const f of profile.features) expectFeatureConforms(f);
    expect(profile.suggestedSmoke).toEqual(['launch']);
  });
});

// ─── profile-inference edge cases ──────────────────────────────────

describe('confidenceForViewName', () => {
  it('assigns 0.75 to well-known domain patterns (case-insensitive)', () => {
    expect(confidenceForViewName('LoginViewController')).toBe(0.75);
    expect(confidenceForViewName('LOGINViewController')).toBe(0.75);
    expect(confidenceForViewName('PaymentFlowViewController')).toBe(0.75);
    expect(confidenceForViewName('SettingsViewController')).toBe(0.75);
  });

  it('assigns 0.6 to common app patterns', () => {
    expect(confidenceForViewName('HomeViewController')).toBe(0.6);
    expect(confidenceForViewName('DashboardViewController')).toBe(0.6);
    expect(confidenceForViewName('PhotoGalleryViewController')).toBe(0.6);
  });

  it('assigns 0.35 to delegate/protocol/helper patterns', () => {
    expect(confidenceForViewName('SomeDelegateHandler')).toBe(0.35);
    expect(confidenceForViewName('DataManager')).toBe(0.35);
    expect(confidenceForViewName('AdapterFactory')).toBe(0.35);
  });

  it('assigns 0.5 to unknown names', () => {
    expect(confidenceForViewName('MysteryViewController')).toBe(0.5);
    expect(confidenceForViewName('Xyzabc')).toBe(0.5);
  });

  it('high-confidence patterns win over lower tiers regardless of order', () => {
    expect(confidenceForViewName('LoginHelper')).toBe(0.75);
    expect(confidenceForViewName('HomeManager')).toBe(0.6);
  });
});

describe('extractKeywords', () => {
  it('maps domain names to keywords', () => {
    expect(extractKeywords('LoginViewController')).toEqual(['login']);
    expect(extractKeywords('PaymentCheckoutViewController')).toEqual(['payment']);
    expect(extractKeywords('CameraRollViewController')).toEqual(['media']);
  });

  it('collects multiple keywords in rule order', () => {
    expect(extractKeywords('LoginSearchViewController')).toEqual(['login', 'search']);
    expect(extractKeywords('ProfileSettingsViewController')).toEqual([
      'profile',
      'account',
      'settings',
    ]);
  });

  it('deduplicates overlapping rules', () => {
    expect(extractKeywords('LoginSignInViewController')).toEqual(['login']);
    expect(extractKeywords('RegisterSignUpViewController')).toEqual(['register', 'signup']);
  });

  it('returns empty array when no rule matches', () => {
    expect(extractKeywords('MysteryViewController')).toEqual([]);
  });
});

describe('isAccountRelated', () => {
  it('flags account-bearing flows', () => {
    for (const name of [
      'LoginViewController',
      'SignInView',
      'SignupController',
      'RegisterView',
      'AuthGate',
      'AccountPage',
      'ProfileView',
      'PaymentView',
      'CheckoutController',
      'OrderHistory',
    ]) {
      expect(isAccountRelated(name)).toBe(true);
    }
  });

  it('does not flag public flows', () => {
    expect(isAccountRelated('HomeViewController')).toBe(false);
    expect(isAccountRelated('SearchViewController')).toBe(false);
    expect(isAccountRelated('MysteryViewController')).toBe(false);
  });
});

describe('inferFeatures', () => {
  it('strips ViewController/Controller/View suffixes for readable names', () => {
    const features = inferFeatures(
      {
        viewControllers: [
          { name: 'LoginViewController', file: 'A.swift' },
          { name: 'FooController', file: 'B.swift' },
          { name: 'HomeView', file: 'C.swift' },
        ],
        storyboardRefs: [],
      },
      true,
    );
    expect(features.map((f) => f.name).sort()).toEqual(['Foo', 'Home', 'Login'].sort());
  });

  it('falls back to the full class name when stripping would empty it', () => {
    const features = inferFeatures(
      { viewControllers: [{ name: 'ViewController', file: 'A.swift' }], storyboardRefs: [] },
      true,
    );
    expect(features[0]?.name).toBe('ViewController');
    expect(features[0]?.entry).toBe('ViewController');
  });

  it('marks testability xcuitest only when the project has XCUITest', () => {
    const withXcui = inferFeatures(
      { viewControllers: [{ name: 'LoginViewController', file: 'A.swift' }], storyboardRefs: [] },
      true,
    );
    const withoutXcui = inferFeatures(
      { viewControllers: [{ name: 'LoginViewController', file: 'A.swift' }], storyboardRefs: [] },
      false,
    );
    expect(withXcui[0]?.testability).toBe('xcuitest');
    expect(withoutXcui[0]?.testability).toBe('device_backend');
  });

  it('omits keywords and requiresAccount when heuristics find nothing', () => {
    const features = inferFeatures(
      { viewControllers: [{ name: 'MysteryViewController', file: 'A.swift' }], storyboardRefs: [] },
      true,
    );
    expect(features[0]?.keywords).toBeUndefined();
    expect(features[0]?.requiresAccount).toBeUndefined();
  });

  it('adds storyboard candidates with basename names and storyboard evidence', () => {
    const features = inferFeatures(
      {
        viewControllers: [],
        storyboardRefs: ['Base.lproj/Main.storyboard', 'Onboarding.storyboard'],
      },
      false,
    );
    expect(features.length).toBe(2);
    const main = features.find((f) => f.entry === 'Base.lproj/Main.storyboard');
    expect(main?.name).toBe('Main');
    expect(main?.confidence).toBe(0.3);
    expect(main?.testability).toBe('device_backend');
    expect(main?.evidence[0]).toBe('Storyboard: Base.lproj/Main.storyboard');
    expect(features.find((f) => f.name === 'Onboarding')).toBeDefined();
  });

  it('deduplicates storyboard refs by entry path', () => {
    const features = inferFeatures(
      {
        viewControllers: [],
        storyboardRefs: ['Base.lproj/Main.storyboard', 'Base.lproj/Main.storyboard'],
      },
      false,
    );
    expect(features.length).toBe(1);
  });

  it('sorts by confidence descending and pins sequential displayOrder', () => {
    const features = inferFeatures(
      {
        viewControllers: [
          { name: 'SomeDelegateHandler', file: 'Low.swift' },
          { name: 'LoginViewController', file: 'High.swift' },
          { name: 'HomeViewController', file: 'Mid.swift' },
        ],
        storyboardRefs: ['Base.lproj/Main.storyboard'],
      },
      true,
    );
    expect(features.map((f) => f.confidence)).toEqual([0.75, 0.6, 0.35, 0.3]);
    expect(features.map((f) => f.displayOrder)).toEqual([0, 1, 2, 3]);
  });

  it('every produced feature carries at least one evidence entry (R4)', () => {
    const features = inferFeatures(
      {
        viewControllers: [
          { name: 'LoginViewController', file: 'A.swift' },
          { name: 'MysteryViewController', file: 'B.swift' },
        ],
        storyboardRefs: ['Base.lproj/Main.storyboard'],
      },
      true,
    );
    for (const f of features) {
      expect(f.evidence.length).toBeGreaterThanOrEqual(1);
      expect(f.confirmed).toBe(false);
    }
  });
});

describe('inferSuggestedSmoke', () => {
  it('always starts with the universal launch baseline', () => {
    expect(inferSuggestedSmoke([])).toEqual(['launch']);
  });

  it('excludes features below 0.5 confidence', () => {
    const smoke = inferSuggestedSmoke(
      inferFeatures({ viewControllers: [], storyboardRefs: ['Base.lproj/Main.storyboard'] }, false),
    );
    expect(smoke).toEqual(['launch']);
  });

  it('includes high-confidence feature names without duplicates', () => {
    const smoke = inferSuggestedSmoke(
      inferFeatures(
        {
          viewControllers: [
            { name: 'LoginViewController', file: 'A.swift' },
            { name: 'Login', file: 'B.swift' },
          ],
          storyboardRefs: [],
        },
        true,
      ),
    );
    expect(smoke.filter((s) => s === 'Login').length).toBe(1);
    expect(smoke[0]).toBe('launch');
    expect(smoke).toContain('Login');
  });

  it('caps suggestions at 8 entries', () => {
    const vcs = Array.from({ length: 12 }, (_, i) => ({
      name: `Login${i}ViewController`,
      file: `F${i}.swift`,
    }));
    const smoke = inferSuggestedSmoke(
      inferFeatures({ viewControllers: vcs, storyboardRefs: [] }, true),
    );
    expect(smoke.length).toBe(8);
    expect(smoke[0]).toBe('launch');
  });
});
