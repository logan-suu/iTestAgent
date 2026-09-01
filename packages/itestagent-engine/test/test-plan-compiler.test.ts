import { describe, expect, it } from 'bun:test';
import type { Intent, TestPlan } from 'itestagent-contracts';
import type { ProjectProfile } from 'itestagent-project-analyzer';
import {
  compileTestPlan as compileTestPlanCore,
  parseTestPlanYaml,
  testPlanToYaml,
} from '../src/test-plan-compiler.js';

const AUTHORITATIVE_NO_XCUITEST_ROUTE = {
  status: 'resolved' as const,
  prefer: 'auto' as const,
  resolvedPath: 'device_backend' as const,
  selectionReason: 'confirmed_no_xcuitest_candidate' as const,
};

function compileTestPlan(
  intent: Intent,
  profile: ProjectProfile,
  options: Parameters<typeof compileTestPlanCore>[2] = {},
) {
  return compileTestPlanCore(intent, profile, {
    ...options,
    executionRoute: options.executionRoute ?? AUTHORITATIVE_NO_XCUITEST_ROUTE,
  });
}

// ─── Fixtures ────────────────────────────────────────────────

function makeProfile(overrides?: Partial<ProjectProfile>): ProjectProfile {
  return {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'a'.repeat(64),
    app: {
      name: 'TestApp',
      bundleId: 'com.example.testapp',
      scheme: 'TestApp',
    },
    targets: [{ name: 'TestApp', type: 'app', bundleId: 'com.example.testapp' }],
    testAssets: {
      hasXCUITest: false,
      hasScheme: true,
      testTargets: [],
    },
    features: [
      {
        name: 'Login',
        entry: 'LoginViewController',
        keywords: ['login'],
        testability: 'device_backend',
        requiresAccount: true,
        evidence: ['Source: LoginViewController.swift'],
        confidence: 0.75,
        confirmed: true,
        displayOrder: 0,
      },
      {
        name: 'Checkout',
        entry: 'CheckoutViewController',
        keywords: ['checkout', 'payment'],
        testability: 'device_backend',
        evidence: ['Source: CheckoutViewController.swift'],
        confidence: 0.6,
        confirmed: false,
        displayOrder: 1,
      },
      {
        name: 'Settings',
        entry: 'SettingsViewController',
        keywords: ['settings'],
        testability: 'device_backend',
        evidence: ['Source: SettingsViewController.swift'],
        confidence: 0.75,
        confirmed: false,
        displayOrder: 2,
      },
    ],
    suggestedSmoke: ['launch', 'Login'],
    ...overrides,
  };
}

function makeIntent(overrides?: Partial<Intent>): Intent {
  return {
    goal: 'run login smoke test',
    targetKind: 'physical',
    deviceHint: '本机 iPhone',
    features: ['Login'],
    metricsRequested: true,
    scope: 'smoke',
    sourceText: '帮我用本机 iPhone 跑一下登录 smoke',
    ...overrides,
  };
}

function makeSimulatorIntent(): Intent {
  return makeIntent({
    goal: 'run login on simulator',
    targetKind: 'simulator',
    deviceHint: 'iPhone Simulator',
    scope: 'explore',
    metricsRequested: false,
    sourceText: '帮我在模拟器上跑登录探索',
  });
}

// ─── Tests ───────────────────────────────────────────────────

describe('compileTestPlan', () => {
  // ── AC1: Unified TestPlan ──────────────────────────────────

  describe('AC1: unified TestPlan from Intent + Profile', () => {
    it('compiles a valid TestPlan from physical intent + profile', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.schemaVersion).toBe('itestagent.test-plan.v3');
      expect(plan.runId).toMatch(
        /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(plan.device.kind).toBe('physical');
      expect(plan.device.physical?.selector).toBe('local_connected');
    });

    it('compiles a valid TestPlan from simulator intent + profile', () => {
      const plan = compileTestPlan(makeSimulatorIntent(), makeProfile());
      expect(plan.device.kind).toBe('simulator');
      expect(plan.device.simulator?.selector).toBe('booted');
      expect(plan.performance.baselineDomain).toBe('simulator');
    });

    it('uses custom runId when provided via options', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile(), {
        runId: 'my-custom-run-001',
      });
      expect(plan.runId).toBe('my-custom-run-001');
    });

    it('validates output against TestPlanSchema (no throw = pass)', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan).toBeTruthy();
      // parseTestPlan is called internally; if output is invalid, compileTestPlan throws.
    });
  });

  // ── AC2: All required fields present ───────────────────────

  describe('AC2: all required TestPlan fields', () => {
    it('includes target field', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.target.type).toBe('current_workspace');
    });

    it('includes device with targetKind and selector', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.device.kind).toBe('physical');
      expect(plan.device.physical?.selector).toBe('local_connected');
    });

    it('includes appSource', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.appSource.strategy).toBe('auto_from_workspace');
    });

    it('includes execution with features/testData/assertion', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.execution.prefer).toBe('auto');
      expect(plan.execution.resolvedPath).toBe('device_backend');
      expect(plan.execution.selectionReason).toBe('confirmed_no_xcuitest_candidate');
      expect(plan.execution.features).toContain('Login');
      expect(plan.execution.testData.allowAgentGeneratedData).toBe(true);
      expect(plan.execution.assertion.policy).toBe('user_goal_then_profile_then_agent_confirmed');
    });

    it('includes metrics when metricsRequested', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.execution.metrics).toBeDefined();
      expect(plan.execution.metrics).toContain('launch_time');
      expect(plan.execution.metrics).toContain('hitches');
    });

    it('includes performance with baselineDomain (ADR-011)', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.performance.baseline).toBe('local_auto');
      expect(plan.performance.baselineDomain).toBe('physical');
    });

    it('includes artifacts and report', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.artifacts.collect).toContain('screenshot');
      expect(plan.artifacts.report.outputs).toContain('summary_md');
      expect(plan.artifacts.report.outputs).toContain('result_json');
      expect(plan.artifacts.report.outputs).toContain('artifact_index_json');
    });

    it('includes safety policy', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.safety.defaultMode).toBe('ask');
      expect(plan.safety.highRiskActions).toContain('clear_app_data');
    });

    it('includes backendPreference', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.backendPreference.device).toContain('appium');
    });
  });

  // ── AC3: Auditable, reproducible, re-runnable ──────────────

  describe('AC3: auditable, reproducible, re-runnable', () => {
    it('generates unique runId per compilation', () => {
      const plan1 = compileTestPlan(makeIntent(), makeProfile());
      const plan2 = compileTestPlan(makeIntent(), makeProfile());
      expect(plan1.runId).not.toBe(plan2.runId);
    });

    it('includes schemaVersion for audit trail', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.schemaVersion).toBe('itestagent.test-plan.v3');
    });

    it('same input produces equivalent plan (different runId only)', () => {
      const plan1 = compileTestPlan(makeIntent(), makeProfile(), { runId: 'fixed' });
      const plan2 = compileTestPlan(makeIntent(), makeProfile(), { runId: 'fixed' });
      expect(plan2.device.kind).toBe(plan1.device.kind);
      expect(plan2.execution.features).toEqual(plan1.execution.features);
    });
  });

  // ── AC4: References Project Profile ────────────────────────

  describe('AC4: references Project Profile', () => {
    it('includes projectProfileRef', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.projectProfileRef).toContain('project-profile.json');
      expect(plan.projectProfileRef).toContain('a'.repeat(64));
    });

    it('uses custom projectProfileRef from options', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile(), {
        projectProfileRef: '/custom/path/profile.json',
      });
      expect(plan.projectProfileRef).toBe('/custom/path/profile.json');
    });
  });

  // ── Execution path logic ───────────────────────────────────

  describe('execution path selection', () => {
    it('requires target-explicit route evidence for auto compilation', () => {
      expect(() => compileTestPlanCore(makeIntent(), makeProfile())).toThrow(
        'execution_route_not_confirmed',
      );
    });

    it('does not treat hasXCUITest as an execution candidate', () => {
      const profileWithXCUITest = makeProfile({
        testAssets: {
          hasXCUITest: true,
          hasScheme: true,
          testTargets: ['TestAppUITests'],
        },
      });
      const plan = compileTestPlan(makeIntent(), profileWithXCUITest);
      expect(plan.execution.prefer).toBe('auto');
      expect(plan.execution.resolvedPath).toBe('device_backend');
    });

    it('compiles the authoritative no-candidate route to DeviceBackend', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.execution.prefer).toBe('auto');
      expect(plan.execution.resolvedPath).toBe('device_backend');
    });
  });

  // ── Metrics resolution ─────────────────────────────────────

  describe('metrics resolution', () => {
    it('collects all metrics for perf scope', () => {
      const plan = compileTestPlan(
        makeIntent({ scope: 'perf', metricsRequested: true }),
        makeProfile(),
      );
      expect(plan.execution.metrics).toContain('fps');
      expect(plan.execution.metrics).toContain('hitches');
    });

    it('collects basic metrics for smoke scope with metricsRequested', () => {
      const plan = compileTestPlan(makeIntent({ metricsRequested: true }), makeProfile());
      expect(plan.execution.metrics).toContain('launch_time');
    });

    it('collects no metrics for explore without metricsRequested', () => {
      const plan = compileTestPlan(
        makeIntent({ scope: 'explore', metricsRequested: false }),
        makeProfile(),
      );
      expect(plan.execution.metrics).toBeUndefined();
    });

    it('collects launch_time+crash for smoke scope without metricsRequested', () => {
      const plan = compileTestPlan(
        makeIntent({ scope: 'smoke', metricsRequested: false }),
        makeProfile(),
      );
      expect(plan.execution.metrics).toContain('launch_time');
      expect(plan.execution.metrics).toContain('crash');
    });
  });

  // ── Assertion policy ───────────────────────────────────────

  describe('assertion policy', () => {
    it('uses explore_only for explore scope', () => {
      const plan = compileTestPlan(makeIntent({ scope: 'explore' }), makeProfile());
      expect(plan.execution.assertion.policy).toBe('explore_only');
    });

    it('uses tiered policy for smoke scope', () => {
      const plan = compileTestPlan(makeIntent({ scope: 'smoke' }), makeProfile());
      expect(plan.execution.assertion.policy).toBe('user_goal_then_profile_then_agent_confirmed');
    });
  });

  // ── confirmedOnly filter ───────────────────────────────────

  describe('confirmedOnly option', () => {
    it('filters features to confirmed candidates only', () => {
      const plan = compileTestPlan(makeIntent({ features: ['Login', 'Settings'] }), makeProfile(), {
        confirmedOnly: true,
      });
      // Only Login is confirmed in the fixture
      expect(plan.execution.features).toEqual(['Login']);
    });

    it('fails closed instead of reintroducing suggestedSmoke when no confirmed feature matches', () => {
      expect(() =>
        compileTestPlan(makeIntent({ features: ['NonExistent'] }), makeProfile(), {
          confirmedOnly: true,
        }),
      ).toThrow('test_plan_not_confirmed');
    });
  });

  // ── Default device fallback ────────────────────────────────

  describe('device default fallback', () => {
    it('defaults to physical when targetKind is undefined', () => {
      const plan = compileTestPlan(makeIntent({ targetKind: undefined }), makeProfile());
      expect(plan.device.kind).toBe('physical');
      expect(plan.performance.baselineDomain).toBe('physical');
    });
  });

  // ── Backend preference resolution ──────────────────────────

  describe('backendPreference resolution', () => {
    it('includes both device and performance backends', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile());
      expect(plan.backendPreference.device).toBeDefined();
      expect(plan.backendPreference.performance).toBeDefined();
    });

    it('simplifies build backend when XCUITest targets exist', () => {
      const plan = compileTestPlan(
        makeIntent(),
        makeProfile({
          testAssets: {
            hasXCUITest: true,
            hasScheme: true,
            testTargets: ['UITests'],
          },
        }),
      );
      expect(plan.backendPreference.build).toEqual(['xcodebuild']);
    });
  });

  // ── YAML round-trip ─────────────────────────────────────────

  describe('YAML serialization round-trip', () => {
    it('serializes and deserializes a TestPlan through YAML', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile(), { runId: 'fixed-run' });
      const yaml = testPlanToYaml(plan);
      const parsed = parseTestPlanYaml(yaml);

      expect(parsed.runId).toBe('fixed-run');
      expect(parsed.device.kind).toBe('physical');
      expect(parsed.execution.features).toEqual(['Login']);
      expect(parsed.performance.baselineDomain).toBe('physical');
    });

    it('round-trips simulator TestPlan through YAML', () => {
      const plan = compileTestPlan(makeSimulatorIntent(), makeProfile(), {
        runId: 'sim-run',
      });
      const yaml = testPlanToYaml(plan);
      const parsed = parseTestPlanYaml(yaml);

      expect(parsed.device.kind).toBe('simulator');
      expect(parsed.device.simulator?.selector).toBe('booted');
      expect(parsed.performance.baselineDomain).toBe('simulator');
    });

    it('produces valid YAML output (not JSON)', () => {
      const plan = compileTestPlan(makeIntent(), makeProfile(), { runId: 'test' });
      const yaml = testPlanToYaml(plan);
      // YAML output should NOT start with { or [
      expect(yaml.trimStart()[0]).not.toBe('{');
      expect(yaml.trimStart()[0]).not.toBe('[');
      // Should contain key: value syntax
      expect(yaml).toContain('schemaVersion:');
      expect(yaml).toContain('runId:');
    });
  });
});

// ─── B14: mvp-test-plan-fields + durable-test-plan ───────────────

describe('B14: mvp-test-plan-fields', () => {
  it('reports no missing fields for a compiled MVP plan', async () => {
    const mod = await import('../src/mvp-test-plan-fields.js');
    const plan = compileTestPlan(makeIntent(), makeProfile(), { runId: 'run_b14' });
    expect(mod.missingMvpTestPlanFields(plan)).toEqual([]);
  });

  it('flags a plan whose required features are empty', async () => {
    const mod = await import('../src/mvp-test-plan-fields.js');
    const plan = compileTestPlan(makeIntent(), makeProfile(), { runId: 'run_b14' });
    const incomplete = {
      ...plan,
      execution: { ...plan.execution, features: [] },
    } as unknown as TestPlan;
    expect(mod.missingMvpTestPlanFields(incomplete)).toContain('execution.features');
  });
});

describe('B14: durable-test-plan', () => {
  it('round-trips a plan through injected fs', async () => {
    const mod = await import('../src/durable-test-plan.js');
    const plan = compileTestPlan(makeIntent(), makeProfile(), { runId: 'run_durable' });
    const store = new Map<string, string>();
    const deps = {
      writeFile: async (p: string, c: string) => {
        store.set(p, c);
      },
      readFile: async (p: string) => {
        const value = store.get(p);
        if (value === undefined) throw new Error('ENOENT');
        return value;
      },
    };
    const saved = await mod.saveTestPlanFile('/fixture/runs/run_durable', plan, deps);
    expect(saved.path.endsWith('plan.yaml')).toBe(true);
    const loaded = await mod.loadTestPlanFile('/fixture/runs/run_durable', deps);
    expect(loaded.runId).toBe('run_durable');
  });
});
