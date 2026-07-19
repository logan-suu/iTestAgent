import { z } from 'zod';
import { TargetKindSchema } from './device-types.js';

/**
 * TestPlan Zod schemas — S3 phase: Intent + Profile → TestPlan.
 *
 * Mirrors schemas/test-plan.schema.json with ADR-011 gap fixes:
 *   - DeviceSelector.kind: TargetKind (physical | simulator)
 *   - PerformancePlan.baselineDomain: TargetKind (baseline isolation)
 *
 * Data Flow Specification §6:
 *   TestPlan is the single source of truth for the entire pipeline (S3→S9).
 *   Stored at ~/.itestagent/runs/<run_id>/plan.yaml
 *   AC3: auditable, reproducible, re-runnable.
 */

// ─── Device Selector (ADR-011 enhanced) ──────────────────────

const PhysicalDeviceSelectorSchema = z.object({
  selector: z.enum(['local_connected', 'by_udid', 'by_name']),
  udid: z.string().optional(),
  name: z.string().optional(),
});

const SimulatorDeviceSelectorSchema = z.object({
  selector: z.enum(['booted', 'by_udid', 'by_name', 'create_from_profile']),
  udid: z.string().optional(),
  name: z.string().optional(),
  runtimeIdentifier: z.string().optional(),
  deviceTypeIdentifier: z.string().optional(),
});

export { PhysicalDeviceSelectorSchema, SimulatorDeviceSelectorSchema };

export const DeviceSelectorSchema = z.object({
  /** Target kind per ADR-011: physical | simulator */
  kind: TargetKindSchema,
  /** Physical device selector (populated when kind=physical) */
  physical: PhysicalDeviceSelectorSchema.optional(),
  /** Simulator device selector (populated when kind=simulator) */
  simulator: SimulatorDeviceSelectorSchema.optional(),
});

export type DeviceSelector = z.infer<typeof DeviceSelectorSchema>;
export type PhysicalDeviceSelector = z.infer<typeof PhysicalDeviceSelectorSchema>;
export type SimulatorDeviceSelector = z.infer<typeof SimulatorDeviceSelectorSchema>;

// ─── Target ──────────────────────────────────────────────────

export const TargetSchema = z.object({
  type: z.enum(['current_workspace', 'user_specified', 'existing_artifact']),
});

export type Target = z.infer<typeof TargetSchema>;

// ─── App Source ──────────────────────────────────────────────

export const AppSourceSchema = z.object({
  strategy: z.enum(['auto_from_workspace', 'user_specified', 'existing_artifact']),
});

export type AppSource = z.infer<typeof AppSourceSchema>;

// ─── Backend Preference ──────────────────────────────────────

const DEVICE_BACKEND_VALUES = ['mobile-mcp', 'appium', 'iphone-use', 'mock'] as const;
const PERF_BACKEND_VALUES = ['xctrace-analyzer-core', 'instrumentsmcp', 'raw-xcrun'] as const;
const BUILD_BACKEND_VALUES = ['xcodebuild', 'fastlane'] as const;
const ANALYZER_BACKEND_VALUES = ['xcodequery', 'xcodeproj'] as const;

export const BackendPreferenceSchema = z.object({
  device: z.array(z.enum(DEVICE_BACKEND_VALUES)).optional(),
  performance: z.array(z.enum(PERF_BACKEND_VALUES)).optional(),
  build: z.array(z.enum(BUILD_BACKEND_VALUES)).optional(),
  analyzer: z.array(z.enum(ANALYZER_BACKEND_VALUES)).optional(),
});

export type BackendPreference = z.infer<typeof BackendPreferenceSchema>;

// ─── Execution Plan ──────────────────────────────────────────

export const AssertionPolicySchema = z.object({
  policy: z.enum(['user_goal_then_profile_then_agent_confirmed', 'explore_only']),
});

export type AssertionPolicy = z.infer<typeof AssertionPolicySchema>;

export const TestDataPolicySchema = z.object({
  allowAgentGeneratedData: z.boolean(),
  askUserInTuiWhenRequired: z.boolean(),
});

export type TestDataPolicy = z.infer<typeof TestDataPolicySchema>;

const METRIC_VALUES = [
  'launch_time',
  'memory_peak',
  'crash',
  'test_duration',
  'hitches',
  'fps',
  'xctrace_summary',
] as const;

export const ExecutionPlanSchema = z.object({
  /** Execution path preference: auto (XCUITest if exists) | xcuitest | device_backend */
  prefer: z.enum(['auto', 'xcuitest', 'device_backend']),
  /** Fallback when preferred path fails: device_backend | abort */
  fallback: z.enum(['device_backend', 'abort']),
  /** Feature names from ProjectProfile to cover */
  features: z.array(z.string()),
  /** Flow YAML IDs to replay */
  flows: z.array(z.string()).optional(),
  /** Test data policy */
  testData: TestDataPolicySchema,
  /** Assertion strategy */
  assertion: AssertionPolicySchema,
  /** Performance metrics to collect */
  metrics: z.array(z.enum(METRIC_VALUES)).optional(),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ─── Artifact Policy ─────────────────────────────────────────

const ARTIFACT_TYPE_VALUES = [
  'screenshot',
  'video',
  'syslog',
  'crashlog',
  'xcresult',
  'trace',
  'uitree',
] as const;

const REPORT_OUTPUT_VALUES = ['summary_md', 'result_json', 'artifact_index_json'] as const;

export const ArtifactPolicySchema = z.object({
  /** Artifact types to collect during execution */
  collect: z.array(z.enum(ARTIFACT_TYPE_VALUES)),
  /** Report outputs (fixed three-piece: no HTML per ADR-004) */
  report: z.object({
    outputs: z.array(z.enum(REPORT_OUTPUT_VALUES)),
  }),
});

export type ArtifactPolicy = z.infer<typeof ArtifactPolicySchema>;

// ─── Performance Plan ────────────────────────────────────────

export const PerformancePlanSchema = z.object({
  /** Baseline strategy */
  baseline: z.enum(['local_auto', 'skip']),
  /** Baseline domain isolation per ADR-011 */
  baselineDomain: TargetKindSchema,
  /** Whether threshold comparison is required */
  thresholdRequired: z.boolean(),
});

export type PerformancePlan = z.infer<typeof PerformancePlanSchema>;

// ─── Permission / Safety Policy ──────────────────────────────

const HIGH_RISK_ACTION_VALUES = [
  'clear_data',
  'reinstall',
  'write_project',
  'store_credential',
  'update_baseline',
  'overwrite_flow',
  'generate_draft',
] as const;

export const PermissionPolicyRefSchema = z.object({
  /** Default permission mode for non-high-risk actions */
  defaultMode: z.enum(['allow', 'ask', 'deny']),
  /** High-risk actions (default: ask per R7) */
  highRiskActions: z.array(z.enum(HIGH_RISK_ACTION_VALUES)),
});

export type PermissionPolicyRef = z.infer<typeof PermissionPolicyRefSchema>;

// ─── Root TestPlan ───────────────────────────────────────────

export const TestPlanSchema = z
  .object({
    /** Schema version for forward-compat migrations (G2) */
    schemaVersion: z.literal('itestagent.test-plan.v1'),
    /** Unique run identifier */
    runId: z.string().min(1),
    /** Reference path to the source Project Profile */
    projectProfileRef: z.string().min(1),
    /** Test target (e.g. current_workspace) */
    target: TargetSchema,
    /** Device selector (ADR-011: kind + physical/simulator) */
    device: DeviceSelectorSchema,
    /** App source strategy */
    appSource: AppSourceSchema,
    /** Pluggable backend preference */
    backendPreference: BackendPreferenceSchema,
    /** Execution plan */
    execution: ExecutionPlanSchema,
    /** Artifact collection and report policy */
    artifacts: ArtifactPolicySchema,
    /** Performance plan (ADR-011: baselineDomain) */
    performance: PerformancePlanSchema,
    /** Safety / permission policy */
    safety: PermissionPolicyRefSchema,
  })
  .strict();

export type TestPlan = z.infer<typeof TestPlanSchema>;

// ─── Parse helpers ───────────────────────────────────────────

/**
 * Safely parse a TestPlan from unknown input.
 * Invalid fields throw ZodError (G2 compliance).
 */
export function parseTestPlan(raw: unknown): TestPlan {
  return TestPlanSchema.parse(raw);
}

/**
 * Validate a TestPlan without throwing.
 * Returns { success, data } or { success, error }.
 */
export function safeParseTestPlan(
  raw: unknown,
): { success: true; data: TestPlan } | { success: false; error: z.ZodError } {
  const result = TestPlanSchema.safeParse(raw);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}
