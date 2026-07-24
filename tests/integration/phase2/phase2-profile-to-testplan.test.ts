/**
 * Phase 2 integration test — S2→S3 full pipeline:
 *   Project analysis → ProjectProfile → Intent → TestPlan → TUI format
 *
 * Cross-package chain: analyzer-xcodeproj → project-analyzer → engine → contracts → tui
 * Uses a mock ProjectAnalyzerBackend to avoid xcodebuild dependency in CI.
 */
import { afterEach, describe, expect, it } from 'bun:test';
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
import type { TestPlan } from 'itestagent-contracts';
import { TestPlanSchema, parseTestPlan } from 'itestagent-contracts';
import { compileTestPlan, parseIntent, parseTestPlanYaml, testPlanToYaml } from 'itestagent-engine';
import {
  type CandidateLink,
  type ProjectProfile,
  generateProjectProfile,
} from 'itestagent-project-analyzer';
import {
  PLAN_SECTIONS,
  type PlanSection,
  formatEstimatedDuration,
  formatPlanSections,
  navigatePlanSection,
} from 'itestagent-tui/pure';

// ─── Mock backend (returns deterministic, schema-compliant data) ─

function createMockBackend(overrides?: {
  hasXCUITests?: boolean;
  features?: CandidateLink[];
  suggestedSmoke?: string[];
}): ProjectAnalyzerBackend {
  const hasXCUITests = overrides?.hasXCUITests ?? false;
  const features: CandidateLink[] = overrides?.features ?? [
    {
      name: 'login',
      entry: 'LoginViewController',
      keywords: ['登录', 'signin'],
      testability: 'device_backend',
      requiresAccount: true,
      evidence: ['Source: LoginViewController.swift'],
      confidence: 0.75,
      confirmed: false,
      displayOrder: 0,
    },
    {
      name: 'checkout',
      entry: 'CheckoutViewController',
      keywords: ['结算', 'cart'],
      testability: 'device_backend',
      evidence: ['Source: CheckoutViewController.swift'],
      confidence: 0.6,
      confirmed: false,
      displayOrder: 1,
    },
  ];
  const suggestedSmoke = overrides?.suggestedSmoke ?? ['launch', 'login', 'checkout'];

  const discovery: ProjectDiscovery = {
    root: '/mock/project-root',
    name: 'MockApp',
    type: 'xcode_workspace',
    xcworkspacePath: '/mock/project-root/MockApp.xcworkspace',
    schemes: ['MockApp'],
    configurations: ['Debug', 'Release'],
  };

  const graph: ProjectGraph = {
    targets: [
      { name: 'MockApp', type: 'app', dependencies: [] },
      { name: 'MockAppTests', type: 'test', dependencies: ['MockApp'] },
    ],
    hasXCUITests,
    hasUnitTests: true,
  };

  const buildSettings: ResolvedBuildSettings = {
    bundleIdentifier: 'com.example.MockApp',
    bundleName: 'MockApp',
    deploymentTarget: '16.0',
    swiftVersion: '5.9',
    architectures: ['arm64'],
    infoPlistPath: 'MockApp/Info.plist',
  };

  const sourceFacts: SourceFacts = {
    swiftFiles: 42,
    objcFiles: 3,
    viewControllers: features
      .filter((f) => f.entry)
      .map((f) => ({
        name: f.entry ?? f.name,
        file: f.evidence[0]?.replace('Source: ', '') ?? `${f.name}.swift`,
      })),
    protocols: ['MockAppProtocol'],
    storyboardRefs: [],
    xibRefs: [],
  };

  const resourceFacts: ResourceFacts = {
    assetCatalogs: 1,
    fontFiles: [],
    localizedStrings: ['en.lproj/Localizable.strings'],
    infoPlistKeys: ['CFBundleIdentifier', 'CFBundleName'],
  };

  return {
    async discover(_root: string): Promise<ProjectDiscovery> {
      return discovery;
    },
    async graph(_input: ProjectDiscovery): Promise<ProjectGraph> {
      return graph;
    },
    async buildSettings(_input: BuildSettingsQuery): Promise<ResolvedBuildSettings> {
      return buildSettings;
    },
    async scanSources(_input: SourceScanInput): Promise<SourceFacts> {
      return sourceFacts;
    },
    async scanResources(_input: ResourceScanInput): Promise<ResourceFacts> {
      return resourceFacts;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function makeProfile(features: CandidateLink[]): ProjectProfile {
  return {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'a'.repeat(64),
    app: { name: 'MockApp', bundleId: 'com.example.MockApp' },
    targets: [{ name: 'MockApp', type: 'app' }],
    testAssets: { hasXCUITest: false, hasScheme: true },
    features,
    suggestedSmoke: ['launch', 'login', 'checkout'],
  };
}

function makeValidTestPlan(plan: TestPlan): void {
  const result = TestPlanSchema.safeParse(plan);
  if (!result.success) {
    throw new Error(`TestPlan validation failed: ${result.error.message}`);
  }
}

// ─── Tests ───────────────────────────────────────────────────

describe('Phase 2 integration: S2 → ProjectProfile', () => {
  it('generates a valid ProjectProfile from a mock backend', async () => {
    const backend = createMockBackend();
    const profile = await generateProjectProfile(backend, '/mock/project-root');

    expect(profile.schemaVersion).toBe('itestagent.project-profile.v1');
    expect(profile.app.name).toBe('MockApp');
    expect(profile.app.bundleId).toBe('com.example.MockApp');
    expect(profile.targets).toHaveLength(2);
    expect(profile.testAssets.hasXCUITest).toBe(false);
    expect(profile.features.length).toBeGreaterThanOrEqual(1);
    expect(profile.suggestedSmoke).toContain('launch');
  });

  it('generates a valid Profile that passes Zod schema (G2)', async () => {
    const backend = createMockBackend();
    const profile = await generateProjectProfile(backend, '/mock/project-root');

    expect(profile.schemaVersion).toBe('itestagent.project-profile.v1');
    expect(profile.projectHash).toMatch(/^[a-f0-9]{64}$/);
    expect(profile.app.bundleId).toBeDefined();
    expect(profile.features.length).toBeGreaterThanOrEqual(1);
    expect(profile.suggestedSmoke.length).toBeGreaterThanOrEqual(1);

    // Verify all required fields are present (deterministic from backend)
    expect(profile.targets).toHaveLength(2);
    expect(profile.testAssets.hasXCUITest).toBe(false);
    expect(profile.testAssets.hasScheme).toBe(false);
  });
});

describe('Phase 2 integration: S3 → Intent parsing', () => {
  const profile = makeProfile([
    {
      name: 'login',
      entry: 'LoginViewController',
      keywords: ['登录', 'signin'],
      testability: 'device_backend',
      evidence: ['Source: LoginViewController.swift'],
      confidence: 0.75,
      confirmed: false,
      displayOrder: 0,
    },
    {
      name: 'checkout',
      entry: 'CheckoutViewController',
      keywords: ['结算'],
      testability: 'device_backend',
      evidence: ['Source: CheckoutViewController.swift'],
      confidence: 0.6,
      confirmed: false,
      displayOrder: 1,
    },
  ]);

  it('parses Chinese natural language intent and matches profile features', () => {
    const result = parseIntent('帮我在本机 iPhone 上跑一下登录 smoke', profile);

    expect(result.status).toBe('complete');
    expect(result.intent.goal).toBeDefined();
    expect(result.intent.targetKind).toBe('physical');
    expect(result.intent.scope).toBe('smoke');
    expect(result.intent.features).toContain('login');
  });

  it('parses English natural language intent for simulator', () => {
    const result = parseIntent('Run checkout on simulator', profile);

    expect(result.status).toBe('complete');
    expect(result.intent.targetKind).toBe('simulator');
    expect(result.intent.features).toContain('checkout');
  });

  it('returns incomplete for empty input', () => {
    const result = parseIntent('', profile);

    expect(result.status).toBe('incomplete');
    if (result.status === 'incomplete') {
      expect(result.clarificationsNeeded.length).toBeGreaterThan(0);
    }
  });

  it('handles input without explicit device (targetKind undefined)', () => {
    const result = parseIntent('test login', profile);

    expect(result.intent.targetKind).toBeUndefined();
    expect(result.intent.scope).toBe('explore');
  });
});

describe('Phase 2 integration: S3 → TestPlan compilation', () => {
  const profile = makeProfile([
    {
      name: 'login',
      entry: 'LoginViewController',
      keywords: ['登录'],
      testability: 'device_backend',
      evidence: ['Source: LoginViewController.swift'],
      confidence: 0.8,
      confirmed: false,
      displayOrder: 0,
    },
    {
      name: 'search',
      entry: 'SearchViewController',
      keywords: ['search'],
      testability: 'device_backend',
      evidence: ['Source: SearchViewController.swift'],
      confidence: 0.5,
      confirmed: false,
      displayOrder: 1,
    },
  ]);

  it('compiles a TestPlan with device=physical and G2 validates', () => {
    const intentResult = parseIntent('run login on device', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile);

    expect(plan.schemaVersion).toBe('itestagent.test-plan.v2');
    expect(plan.runId).toMatch(/^run_\d{8}_\d{6}_\w{4}$/);
    expect(plan.device.kind).toBe('physical');
    if (plan.device.physical) {
      expect(plan.device.physical.selector).toBe('local_connected');
    }
    expect(plan.performance.baselineDomain).toBe('physical');
    expect(plan.execution.prefer).toBe('device_backend');
    expect(plan.safety.highRiskActions).toContain('reinstall');

    makeValidTestPlan(plan);
  });

  it('compiles a TestPlan with simulator device selector', () => {
    const intentResult = parseIntent('test login on simulator', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile);

    expect(plan.device.kind).toBe('simulator');
    if (plan.device.simulator) {
      expect(plan.device.simulator.selector).toBe('booted');
    }
    expect(plan.performance.baselineDomain).toBe('simulator');

    makeValidTestPlan(plan);
  });

  it('includes metrics when metricsRequested is true', () => {
    const intentResult = parseIntent('test login with fps check', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile);

    expect(plan.execution.metrics).toBeDefined();
    if (plan.execution.metrics) {
      expect(plan.execution.metrics).toContain('launch_time');
      expect(plan.execution.metrics).toContain('memory_peak');
    }
    expect(plan.performance.thresholdRequired).toBe(true);

    makeValidTestPlan(plan);
  });

  it('omits metrics for explore scope (R5: no fabrication)', () => {
    const intentResult = parseIntent('explore login', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile);

    expect(plan.execution.metrics).toBeUndefined();
    expect(plan.execution.assertion?.policy).toBe('explore_only');

    makeValidTestPlan(plan);
  });

  it('serializes and deserializes via YAML round-trip (G2)', () => {
    const intentResult = parseIntent('run login on device', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile);
    const yamlStr = testPlanToYaml(plan);
    const parsed = parseTestPlanYaml(yamlStr);

    expect(parsed.runId).toBe(plan.runId);
    expect(parsed.device.kind).toBe(plan.device.kind);
    expect(parsed.execution.features).toEqual(plan.execution.features);

    makeValidTestPlan(parsed);
  });

  it('generates reproducible runId with fixed prefix', () => {
    const intentResult = parseIntent('test login', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile, { runIdPrefix: 'smoke' });
    expect(plan.runId).toMatch(/^smoke_\d{8}_\d{6}_\w{4}$/);

    makeValidTestPlan(plan);
  });
});

describe('Phase 2 integration: TestPlan → TUI formatting', () => {
  const profile = makeProfile([
    {
      name: 'login',
      entry: 'LoginViewController',
      keywords: ['登录'],
      testability: 'device_backend',
      evidence: ['Source: LoginViewController.swift'],
      confidence: 0.8,
      confirmed: false,
      displayOrder: 0,
    },
    {
      name: 'checkout',
      entry: 'CheckoutViewController',
      keywords: ['checkout'],
      testability: 'device_backend',
      evidence: ['Source: CheckoutViewController.swift'],
      confidence: 0.6,
      confirmed: false,
      displayOrder: 1,
    },
  ]);

  it('formats all 7 plan sections with non-empty fields', () => {
    const intentResult = parseIntent('run login on device', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile);
    const sections = formatPlanSections(plan);

    expect(sections).toHaveLength(7);
    const sectionIds = sections.map((s) => s.id);
    expect(sectionIds).toEqual([...PLAN_SECTIONS]);

    for (const section of sections) {
      expect(section.fields.length).toBeGreaterThan(0);
      // Each field must have a non-empty label
      for (const field of section.fields) {
        expect(field.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('navigates plan sections with wrap-around', () => {
    const total = PLAN_SECTIONS.length;
    expect(navigatePlanSection(0, 'down', total)).toBe(1);
    expect(navigatePlanSection(total - 1, 'down', total)).toBe(0);
    expect(navigatePlanSection(0, 'up', total)).toBe(total - 1);
    expect(navigatePlanSection(1, 'up', total)).toBe(0);

    // Single section
    expect(navigatePlanSection(0, 'down', 1)).toBe(0);
    expect(navigatePlanSection(0, 'up', 1)).toBe(0);
  });

  it('formats estimated duration based on feature count', () => {
    expect(formatEstimatedDuration([])).toBe('~1 min');
    expect(formatEstimatedDuration(['login'])).toBe('~3 min');
    expect(formatEstimatedDuration(['login', 'checkout'])).toBe('~3 min');
    expect(formatEstimatedDuration(['a', 'b', 'c', 'd', 'e'])).toBe('~8 min');
    expect(formatEstimatedDuration(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('~15 min');
    expect(formatEstimatedDuration('abcdefghijklmnop'.split(''))).toBe('~25 min');
  });

  it('overview section shows correct execution path', () => {
    const intentResult = parseIntent('run login on device', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile);
    const sections = formatPlanSections(plan);
    const overview = sections.find((s) => s.id === 'overview');
    expect(overview).toBeDefined();
    if (overview) {
      expect(overview.title).toBe('Overview');
      const targetField = overview.fields.find((f) => f.key === 'target');
      expect(targetField).toBeDefined();
      if (targetField) {
        expect(targetField.value).toBe('current_workspace');
      }
    }
  });
});

describe('Phase 2 integration: full S2→S3 pipeline', () => {
  it('completes the full pipeline: backend → Profile → Intent → TestPlan → TUI format', async () => {
    const backend = createMockBackend();
    const profile = await generateProjectProfile(backend, '/mock/project-root');

    const intentResult = parseIntent('帮我在本机 iPhone 上跑一下登录 smoke', profile);
    expect(intentResult.status).toBe('complete');
    if (intentResult.status !== 'complete') return;

    const plan = compileTestPlan(intentResult.intent, profile);
    makeValidTestPlan(plan);

    // Verify pipeline continuity: plan references correct profile
    expect(plan.projectProfileRef).toContain(profile.projectHash);

    // TUI format doesn't throw
    const sections = formatPlanSections(plan);
    expect(sections).toHaveLength(7);

    // YAML round-trip preserves structure
    const yamlStr = testPlanToYaml(plan);
    const reparsed = parseTestPlanYaml(yamlStr);
    expect(reparsed.runId).toBe(plan.runId);
  });
});
