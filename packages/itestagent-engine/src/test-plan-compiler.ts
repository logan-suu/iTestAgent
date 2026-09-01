/**
 * Intent→TestPlan compiler — B14 module split note: MVP field gating lives in
 * mvp-test-plan-fields and plan.yaml persistence in durable-test-plan; this
 * module stays the Intent+Profile→TestPlan compiler plus YAML helpers.
 */
import type { Intent } from 'itestagent-contracts';
import {
  type AssertionPolicy,
  type DeviceSelector,
  type ExecutionPlan,
  type TestPlan,
  TestPlanSchema,
  createId,
  parseTestPlan,
} from 'itestagent-contracts';
import { migrateTestPlanToV3 } from 'itestagent-contracts/migrations';
import type { ProjectProfile } from 'itestagent-project-analyzer';
import YAML from 'yaml';
import type { ExecutionRouteResolution } from './execution-route-resolver.js';

// Re-export schema types for convenience
export type { TestPlan, DeviceSelector, ExecutionPlan, AssertionPolicy };

/**
 * compileTestPlan — S3 phase: Intent + ProjectProfile → TestPlan.
 *
 * Data Flow Specification §6:
 *   Input:  Intent + ProjectProfile + user-confirmed candidate links
 *   Output: plan.yaml at ~/.itestagent/runs/<run_id>/plan.yaml
 *
 * AC1: Natural language, TUI operations, and CLI commands all compile to a unified TestPlan.
 * AC2: TestPlan includes target/device/appSource/execution/features/testData/assertion/
 *      flows/metrics/performance/artifacts/report.
 * AC3: Auditable, reproducible, re-runnable (runId + schemaVersion + projectProfileRef).
 * AC4: TestPlan references Project Profile (projectProfileRef).
 *
 * @param intent  Parsed user Intent from S1.
 * @param profile Project Profile from S2.
 * @param options Optional overrides for flows, confirmed-only features filter, runId prefix.
 */
export function compileTestPlan(
  intent: Intent,
  profile: ProjectProfile,
  options?: CompileOptions,
): TestPlan {
  const runId = options?.runId ?? createId(options?.runIdPrefix ?? 'run');
  const projectProfileRef = options?.projectProfileRef ?? profileRef(profile.projectHash);

  // ── Device selector (ADR-011: kind-driven) ────────────────
  const device = resolveDevice(intent);

  // ── Execution plan ────────────────────────────────────────
  const execution = buildExecutionPlan(intent, profile, options);

  // ── Performance plan (ADR-011: baselineDomain) ─────────────
  const targetKind = intent.targetKind ?? 'physical';
  const performance = {
    baseline: 'local_auto' as const,
    baselineDomain: targetKind,
    thresholdRequired: intent.metricsRequested,
  };

  const plan: TestPlan = {
    schemaVersion: 'itestagent.test-plan.v3',
    runId,
    projectProfileRef,
    target: { type: 'current_workspace' },
    device,
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: resolveBackendPreference(profile),
    execution,
    artifacts: {
      collect: ['screenshot', 'uitree', 'crashlog', 'xcresult'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance,
    safety: {
      defaultMode: 'ask',
      highRiskActions: ['clear_data', 'reinstall', 'store_credential', 'update_baseline'],
    },
  };

  // G2: Validate against Zod schema before returning
  return parseTestPlan(plan);
}

// ─── Options ─────────────────────────────────────────────────

export interface CompileOptions {
  /** Override the generated runId (for testing / CLI override). */
  runId?: string;
  /** Prefix for auto-generated runId. Default: "run". */
  runIdPrefix?: string;
  /** Override project profile ref path. */
  projectProfileRef?: string;
  /**
   * Confirmation gate marker. Compilation is always confirmed-only; callers
   * may pass true to make that boundary explicit at a production call site.
   */
  confirmedOnly?: true;
  /** Override test data policy (defaults: allowAgentGeneratedData=true, askUserInTuiWhenRequired=true). */
  testData?: Partial<{ allowAgentGeneratedData: boolean; askUserInTuiWhenRequired: boolean }>;
  /** Route resolved from session execution assets before plan confirmation. */
  executionRoute?: Extract<ExecutionRouteResolution, { status: 'resolved' }>;
}

// ─── Private helpers ─────────────────────────────────────────

/** Build a reference path to the project-profile.json */
function profileRef(projectHash: string): string {
  return `~/.itestagent/projects/${projectHash}/project-profile.json`;
}

/** Resolve device selector from Intent.targetKind */
function resolveDevice(intent: Intent): DeviceSelector {
  const kind = intent.targetKind ?? 'physical';

  if (kind === 'simulator') {
    return {
      kind: 'simulator',
      simulator: { selector: 'booted' },
    };
  }

  return {
    kind: 'physical',
    physical: { selector: 'local_connected' },
  };
}

/** Build ExecutionPlan from Intent + Profile */
function buildExecutionPlan(
  intent: Intent,
  profile: ProjectProfile,
  options?: CompileOptions,
): ExecutionPlan {
  // US-3.3 AC3/AC4: only explicitly confirmed candidate links can enter a
  // TestPlan. Never reintroduce inferred suggestedSmoke entries after this
  // filter; doing so would turn an unconfirmed inference into an execution
  // fact.
  const confirmedNames = new Set(
    profile.features.filter((feature) => feature.confirmed).map((feature) => feature.name),
  );
  const features = intent.features.filter((feature) => confirmedNames.has(feature));

  if (features.length === 0) {
    throw new TestPlanConfirmationError(intent.features);
  }

  const prefer = intent.executionPreference ?? 'auto';
  const route = options?.executionRoute ?? defaultExecutionRoute(prefer);

  // Metrics selection
  const metrics = resolveMetrics(intent);

  return {
    prefer,
    fallback: route.resolvedPath === 'xcuitest' ? 'abort' : 'device_backend',
    resolvedPath: route.resolvedPath,
    selectionReason: route.selectionReason,
    features,
    testData: {
      allowAgentGeneratedData: options?.testData?.allowAgentGeneratedData ?? true,
      askUserInTuiWhenRequired: options?.testData?.askUserInTuiWhenRequired ?? true,
    },
    assertion: resolveAssertionPolicy(intent),
    metrics,
    ...(route.xcuitest ? { xcuitest: route.xcuitest } : {}),
  };
}

function defaultExecutionRoute(
  prefer: 'auto' | 'xcuitest' | 'device_backend',
): Extract<ExecutionRouteResolution, { status: 'resolved' }> {
  if (prefer === 'xcuitest') {
    throw new ExecutionRouteConfirmationError(
      'explicit XCUITest selection requires a uniquely resolved runnable configuration',
    );
  }
  return {
    status: 'resolved',
    prefer,
    resolvedPath: 'device_backend',
    selectionReason: prefer === 'device_backend' ? 'explicit_preference' : 'no_runnable_xcuitest',
  };
}

export class ExecutionRouteConfirmationError extends Error {
  constructor(message: string) {
    super(`execution_route_not_confirmed: ${message}`);
    this.name = 'ExecutionRouteConfirmationError';
  }
}

/** Raised when S3 is attempted without a user-confirmed candidate link. */
export class TestPlanConfirmationError extends Error {
  readonly requestedFeatures: readonly string[];

  constructor(requestedFeatures: readonly string[]) {
    super('test_plan_not_confirmed: select and confirm at least one candidate before compilation');
    this.name = 'TestPlanConfirmationError';
    this.requestedFeatures = [...requestedFeatures];
  }
}

/** Select metrics based on Intent.scope and metricsRequested */
function resolveMetrics(intent: Intent): ExecutionPlan['metrics'] {
  // Perf scope always collects all metrics
  if (intent.scope === 'perf') {
    return ['launch_time', 'memory_peak', 'crash', 'test_duration', 'hitches', 'fps'] as const;
  }

  // Metrics explicitly requested
  if (intent.metricsRequested) {
    return ['launch_time', 'memory_peak', 'crash', 'hitches'] as const;
  }

  // Smoke: collect basic health metrics
  if (intent.scope === 'smoke') {
    return ['launch_time', 'crash'] as const;
  }

  // Explore / custom: no metrics by default (R5: don't fabricate)
  return undefined;
}

/** Resolve assertion policy from Intent scope */
function resolveAssertionPolicy(intent: Intent): AssertionPolicy {
  // explore scope → explore_only; all others → tiered policy
  if (intent.scope === 'explore') {
    return { policy: 'explore_only' };
  }
  return { policy: 'user_goal_then_profile_then_agent_confirmed' };
}

/** Resolve backend preference from Profile test assets */
function resolveBackendPreference(profile: ProjectProfile) {
  const pref: Record<string, string[]> = {
    device: ['appium', 'mock'],
    performance: ['xctrace-analyzer-core', 'raw-xcrun'],
    build: ['xcodebuild', 'fastlane'],
    analyzer: ['xcodeproj'],
  };

  // If XCUITest targets exist, prefer xcodebuild build path
  if (profile.testAssets.hasXCUITest) {
    pref.build = ['xcodebuild'];
  }

  return pref;
}

// ─── YAML serialization ──────────────────────────────────────

/**
 * Serialize a TestPlan to YAML string.
 * Uses the `yaml` npm package (YAML 1.2 / ECMA-404 compliant).
 */
export function testPlanToYaml(plan: TestPlan): string {
  return YAML.stringify(plan);
}

/**
 * Parse a YAML test plan string back to TestPlan.
 * Validates against Zod schema (G2 compliance).
 */
export function parseTestPlanYaml(yamlStr: string): TestPlan {
  const obj = YAML.parse(yamlStr);
  const migrated = migrateTestPlanToV3(obj);
  if (!migrated.ok) {
    throw new TestPlanMigrationError(migrated.issues);
  }
  return parseTestPlan(migrated.value);
}

export class TestPlanMigrationError extends Error {
  constructor(readonly issues: readonly { code: string; message: string }[]) {
    super(
      `test_plan_migration_failed: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join('; ')}`,
    );
    this.name = 'TestPlanMigrationError';
  }
}
