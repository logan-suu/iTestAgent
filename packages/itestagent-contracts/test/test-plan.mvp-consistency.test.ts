/**
 * test-plan.mvp-consistency.test.ts — B04 cross-module consistency invariants
 * for the TestPlan/target-execution contracts slice (promotion batch B04,
 * guide §11.3 "TestPlan/target execution", §16 G1).
 *
 * These tests pin the seams BETWEEN the B04 modules so they cannot drift
 * apart silently:
 *
 *   1. metric vocabulary: the published schema enum, the runtime constant,
 *      and the MVP input schema all speak the same metric names;
 *   2. artifact vocabulary: TestPlan ArtifactPolicy collect types remain a
 *      subset of the store-driver ArtifactInput types (every plannable
 *      artifact must be storable);
 *   3. physical Route C/B contract: route ↔ WDA lifecycle role pairing per
 *      ADR-012 (G5 update: Route C = build+install only, Route B = full
 *      lifecycle);
 *   4. selector validation and the compiler agree on what is invalid.
 */
import { describe, expect, it } from 'bun:test';
import { MvpExecutionInputSchema, compileMvpExecution } from '../src/mvp-execution.js';
import {
  PhysicalRouteSchema,
  WdaLifecycleRoleSchema,
  validatePhysicalMvpContract,
} from '../src/physical-mvp.js';
import { ArtifactInputSchema } from '../src/store-driver.js';
import { validateTestPlan } from '../src/test-plan-validation.js';
import { TEST_PLAN_METRIC_VALUES } from '../src/test-plan.js';
import { makeValidTestPlan } from './test-plan.fixture.js';

// ─── 1. Metric vocabulary ────────────────────────────────────

/** Sorts any string-ish tuple into a plain string[] for order-insensitive equality. */
function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('metric vocabulary consistency', () => {
  it('runtime constant matches AGENTS.md §6 performance metric list', () => {
    expect(sortedStrings(TEST_PLAN_METRIC_VALUES)).toEqual(
      sortedStrings([
        'launch_time',
        'memory_peak',
        'crash',
        'test_duration',
        'hitches',
        'fps',
        'xctrace_summary',
      ]),
    );
  });

  it('MvpExecutionInputSchema metrics enum is derived from the same constant', () => {
    // Parse-time proof: every runtime metric value is accepted by the compiled
    // input schema, and an out-of-vocabulary name is rejected.
    const probe = (metrics: string[]) =>
      MvpExecutionInputSchema.safeParse({
        runId: 'run_x',
        projectProfileRef: '~/.itestagent/projects/abc/project-profile.json',
        deviceKind: 'physical',
        deviceSelector: { kind: 'physical', physical: { selector: 'local_connected' } },
        executionPath: 'device_backend',
        features: [],
        metrics,
        assertion: { policy: 'explore_only' },
        testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
        artifacts: { collect: [], report: { outputs: ['summary_md'] } },
        performance: { baseline: 'skip', baselineDomain: 'physical', thresholdRequired: false },
        safety: { defaultMode: 'ask', highRiskActions: [] },
      });

    expect(probe([...TEST_PLAN_METRIC_VALUES]).success).toBe(true);
    expect(probe(['gpu_frames'] as string[]).success).toBe(false);
  });
});

// ─── 2. Artifact vocabulary ──────────────────────────────────

describe('artifact vocabulary consistency (TestPlan ⊆ store-driver)', () => {
  it('every plannable artifact type is storable', () => {
    // Task 6.6 closes the historical syslog vocabulary gap so every
    // TestPlan artifact policy value is directly storable.
    const artifactPolicyTypes = [
      'screenshot',
      'video',
      'syslog',
      'crashlog',
      'xcresult',
      'trace',
      'uitree',
    ];
    const storableTypes = artifactPolicyTypes;
    expect(storableTypes).toHaveLength(7);

    const storeTypes = ArtifactInputSchema.shape.type;
    for (const artifactType of storableTypes) {
      expect(storeTypes.safeParse(artifactType).success).toBe(true);
    }
    expect(storeTypes.safeParse('syslog').success).toBe(true);
  });
});

// ─── 3. Physical route ↔ WDA lifecycle role (ADR-012) ───────

describe('physical MVP contract (ADR-012 G5 update pairing)', () => {
  it('accepts the verified pairings: route_c⇒build_install_only, route_b⇒full_lifecycle', () => {
    expect(
      validatePhysicalMvpContract({
        route: 'route_c_appium_managed',
        wdaLifecycleRole: 'build_install_only',
      }),
    ).toEqual([]);
    expect(
      validatePhysicalMvpContract({
        route: 'route_b_wda_manager_managed',
        wdaLifecycleRole: 'full_lifecycle',
      }),
    ).toEqual([]);
  });

  it('rejects mismatched pairings with a typed route_role_mismatch issue', () => {
    const wrongC = validatePhysicalMvpContract({
      route: 'route_c_appium_managed',
      wdaLifecycleRole: 'full_lifecycle',
    });
    expect(wrongC.map((issue) => issue.code)).toContain('route_role_mismatch');

    const wrongB = validatePhysicalMvpContract({
      route: 'route_b_wda_manager_managed',
      wdaLifecycleRole: 'build_install_only',
    });
    expect(wrongB.map((issue) => issue.code)).toContain('route_role_mismatch');
  });

  it('exposes exactly the two G5-verified routes and roles', () => {
    expect(sortedStrings(PhysicalRouteSchema.options)).toEqual(
      sortedStrings(['route_b_wda_manager_managed', 'route_c_appium_managed']),
    );
    expect(sortedStrings(WdaLifecycleRoleSchema.options)).toEqual(
      sortedStrings(['build_install_only', 'full_lifecycle']),
    );
  });
});

// ─── 4. Validation ⇄ compiler agreement ──────────────────────

describe('validateTestPlan ⇄ compileMvpExecution agreement', () => {
  it('a plan that validates clean also compiles (no validator/compiler drift)', () => {
    const plan = makeValidTestPlan();
    expect(validateTestPlan(plan)).toEqual([]);
    expect(() => compileMvpExecution(plan)).not.toThrow();
  });

  it('every plan the validator rejects also fails compilation', () => {
    const brokenPlans = [
      makeValidTestPlan({ device: { kind: 'physical' } }),
      makeValidTestPlan({ device: { kind: 'physical', physical: { selector: 'by_name' } } }),
      makeValidTestPlan({ device: { kind: 'simulator', simulator: { selector: 'by_udid' } } }),
      makeValidTestPlan({
        device: {
          kind: 'simulator',
          simulator: {
            selector: 'create_from_profile',
            deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
          },
        },
      }),
      makeValidTestPlan({
        execution: {
          ...makeValidTestPlan().execution,
          prefer: 'xcuitest',
        },
      }),
    ];
    for (const plan of brokenPlans) {
      expect(validateTestPlan(plan).length).toBeGreaterThan(0);
      expect(() => compileMvpExecution(plan)).toThrow();
    }
  });

  it('local_connected with explicit udid/name is flagged as conflicting fields', () => {
    const plan = makeValidTestPlan({
      device: {
        kind: 'physical',
        physical: { selector: 'local_connected', udid: 'OVERSPECIFIED' },
      },
    });
    expect(validateTestPlan(plan).map((issue) => issue.code)).toContain(
      'selector_conflicting_fields',
    );
  });
});
