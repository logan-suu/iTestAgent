import { z } from 'zod';
import { validateTestPlan } from './test-plan-validation.js';
import type {
  ArtifactPolicy,
  AssertionPolicy,
  ExecutionPlan,
  PerformancePlan,
  PermissionPolicyRef,
  TestDataPolicy,
  TestPlan,
  TestPlanMetric,
  XcuitestTarget,
} from './test-plan.js';
import { XcuitestTargetSchema } from './test-plan.js';
import type { PhysicalDeviceSelector, SimulatorDeviceSelector } from './test-plan.js';

/**
 * MVP target execution contracts — B04 (promotion guide §11.3
 * "TestPlan/target execution"; ADR-001 de-risk MVP).
 *
 * compileMvpExecution normalizes a canonical TestPlan into the flat
 * MvpExecutionInput consumed by the engine target-execution lane (B14
 * compiler, B15 execution). It is the contracts-layer prelude to S4
 * (TestPlan → RunPlan, Data Flow Specification §6→§7): pure, total, and
 * fail-closed — an invalid plan never silently degrades (R5).
 *
 * The canonical v3 TestPlan already contains the confirmed route. Execution
 * consumes `resolvedPath` and never re-infers a route from preference or
 * ProjectProfile compatibility fields (ADR-029).
 */

export const MVP_EXECUTION_PATH_VALUES = ['xcuitest', 'device_backend'] as const;

export const MvpExecutionPathSchema = z.enum(MVP_EXECUTION_PATH_VALUES);

export type MvpExecutionPath = z.infer<typeof MvpExecutionPathSchema>;

/**
 * Discriminated device selector carried into execution; exactly one branch
 * is populated, keyed by the plan's device.kind.
 */
export const MvpDeviceSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('physical'), physical: z.custom<PhysicalDeviceSelector>() }),
  z.object({ kind: z.literal('simulator'), simulator: z.custom<SimulatorDeviceSelector>() }),
]);

export type MvpDeviceSelector = z.infer<typeof MvpDeviceSelectorSchema>;

const MVP_METRIC_VALUES: readonly [TestPlanMetric, ...TestPlanMetric[]] = [
  'launch_time',
  'memory_peak',
  'crash',
  'test_duration',
  'hitches',
  'fps',
  'xctrace_summary',
];

export const MvpExecutionInputSchema = z.object({
  runId: z.string().min(1),
  projectProfileRef: z.string().min(1),
  deviceKind: z.enum(['physical', 'simulator']),
  deviceSelector: MvpDeviceSelectorSchema,
  executionPath: MvpExecutionPathSchema,
  features: z.array(z.string()),
  flows: z.array(z.string()).optional(),
  metrics: z.array(z.enum(MVP_METRIC_VALUES)).optional(),
  assertion: z.custom<AssertionPolicy>(),
  testData: z.custom<TestDataPolicy>(),
  artifacts: z.custom<ArtifactPolicy>(),
  performance: z.custom<PerformancePlan>(),
  safety: z.custom<PermissionPolicyRef>(),
  xcuitest: XcuitestTargetSchema.optional(),
});

export type MvpExecutionInput = {
  runId: string;
  projectProfileRef: string;
  deviceKind: 'physical' | 'simulator';
  deviceSelector: MvpDeviceSelector;
  executionPath: MvpExecutionPath;
  features: string[];
  flows?: string[];
  metrics?: TestPlanMetric[];
  assertion: AssertionPolicy;
  testData: TestDataPolicy;
  artifacts: ArtifactPolicy;
  performance: PerformancePlan;
  safety: PermissionPolicyRef;
  xcuitest?: XcuitestTarget;
};

/** Thrown by compileMvpExecution when validateTestPlan reports issues. */
export class MvpCompilationError extends Error {
  readonly issues: ReturnType<typeof validateTestPlan>;

  constructor(issues: ReturnType<typeof validateTestPlan>) {
    super(
      `cannot compile MVP execution from invalid TestPlan (${issues.length} issue(s)): ${issues
        .map((issue) => `${issue.path}: ${issue.code}`)
        .join('; ')}`,
    );
    this.name = 'MvpCompilationError';
    this.issues = issues;
  }
}

function resolveDeviceSelector(plan: TestPlan): MvpDeviceSelector {
  return plan.device.kind === 'physical'
    ? { kind: 'physical', physical: plan.device.physical as PhysicalDeviceSelector }
    : { kind: 'simulator', simulator: plan.device.simulator as SimulatorDeviceSelector };
}

/**
 * Compiles a canonical TestPlan into the normalized MVP execution input.
 * Fail-closed: cross-field validation issues abort compilation with a typed
 * {@link MvpCompilationError}.
 */
export function compileMvpExecution(plan: TestPlan): MvpExecutionInput {
  const issues = validateTestPlan(plan);
  if (issues.length > 0) {
    throw new MvpCompilationError(issues);
  }

  return {
    runId: plan.runId,
    projectProfileRef: plan.projectProfileRef,
    deviceKind: plan.device.kind,
    deviceSelector: resolveDeviceSelector(plan),
    executionPath: plan.execution.resolvedPath,
    features: plan.execution.features,
    flows: plan.execution.flows,
    metrics: plan.execution.metrics,
    assertion: plan.execution.assertion,
    testData: plan.execution.testData,
    artifacts: plan.artifacts,
    performance: plan.performance,
    safety: plan.safety,
    xcuitest: plan.execution.xcuitest,
  };
}
