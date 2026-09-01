import type { TestPlan } from './test-plan.js';

/**
 * TestPlan cross-field validation — B04 (promotion guide §11.3
 * "TestPlan/target execution").
 *
 * The Zod schema validates field SHAPES; this module validates cross-field
 * COMPLETENESS that a schema cannot express (same split as B03's
 * json-schema-cross-field.ts for result/artifact-index):
 *
 *   - device.kind must be paired with its matching selector object;
 *   - each physical/simulator selector kind requires exactly the fields it
 *     promises (by_udid → udid, by_name → name, create_from_profile →
 *     runtimeIdentifier + deviceTypeIdentifier);
 *   - local_connected/booted are discovery selectors and must not carry
 *     over-specified identity fields;
 *   - prefer=xcuitest requires an explicit ExecutionPlan.xcuitest.scheme
 *     (target-explicit: never guess an XCUITest target, R4).
 *
 * Pure function over an already-parsed TestPlan: returns typed issues,
 * never throws. compileMvpExecution treats a non-empty list as fail-closed.
 */

export const TEST_PLAN_VALIDATION_ISSUE_CODES = [
  'selector_kind_mismatch',
  'selector_missing_field',
  'selector_conflicting_fields',
  'xcuitest_prefer_without_scheme',
  'xcuitest_route_without_configuration',
  'device_route_with_xcuitest_configuration',
  'explicit_preference_route_mismatch',
  'xcuitest_route_requires_abort',
] as const;

export type TestPlanValidationIssueCode = (typeof TEST_PLAN_VALIDATION_ISSUE_CODES)[number];

export interface TestPlanValidationIssue {
  code: TestPlanValidationIssueCode;
  message: string;
  path: string;
}

export class TestPlanValidationError extends Error {
  readonly issues: readonly TestPlanValidationIssue[];

  constructor(issues: readonly TestPlanValidationIssue[]) {
    super(
      `TestPlan validation failed (${issues.length} issue(s)): ${issues.map((issue) => `${issue.path}: ${issue.code}`).join('; ')}`,
    );
    this.name = 'TestPlanValidationError';
    this.issues = issues;
  }
}

function missing(path: string, field: string): TestPlanValidationIssue {
  return {
    code: 'selector_missing_field',
    path,
    message: `selector requires "${field}" to be set`,
  };
}

function conflicting(path: string, fields: string[]): TestPlanValidationIssue {
  return {
    code: 'selector_conflicting_fields',
    path,
    message: `discovery selector must not over-specify [${fields.join(', ')}]`,
  };
}

/** Validates physical selector completeness for the plan's device.kind. */
function validatePhysical(plan: TestPlan): TestPlanValidationIssue[] {
  const issues: TestPlanValidationIssue[] = [];
  const physical = plan.device.physical;
  if (!physical) {
    issues.push({
      code: 'selector_kind_mismatch',
      path: 'device.physical',
      message: 'device.kind="physical" requires a physical selector object',
    });
    return issues;
  }

  const path = 'device.physical';
  switch (physical.selector) {
    case 'local_connected': {
      const overspecified = [
        physical.udid !== undefined && 'udid',
        physical.name !== undefined && 'name',
      ].filter((value): value is string => typeof value === 'string');
      if (overspecified.length > 0) issues.push(conflicting(path, overspecified));
      break;
    }
    case 'by_udid':
      if (physical.udid === undefined) issues.push(missing(path, 'udid'));
      break;
    case 'by_name':
      if (physical.name === undefined) issues.push(missing(path, 'name'));
      break;
  }
  return issues;
}

/** Validates simulator selector completeness for the plan's device.kind. */
function validateSimulator(plan: TestPlan): TestPlanValidationIssue[] {
  const issues: TestPlanValidationIssue[] = [];
  const simulator = plan.device.simulator;
  if (!simulator) {
    issues.push({
      code: 'selector_kind_mismatch',
      path: 'device.simulator',
      message: 'device.kind="simulator" requires a simulator selector object',
    });
    return issues;
  }

  const path = 'device.simulator';
  switch (simulator.selector) {
    case 'booted': {
      const overspecified = [
        simulator.udid !== undefined && 'udid',
        simulator.name !== undefined && 'name',
      ].filter((value): value is string => typeof value === 'string');
      if (overspecified.length > 0) issues.push(conflicting(path, overspecified));
      break;
    }
    case 'by_udid':
      if (simulator.udid === undefined) issues.push(missing(path, 'udid'));
      break;
    case 'by_name':
      if (simulator.name === undefined) issues.push(missing(path, 'name'));
      break;
    case 'create_from_profile':
      if (simulator.runtimeIdentifier === undefined)
        issues.push(missing(path, 'runtimeIdentifier'));
      if (simulator.deviceTypeIdentifier === undefined)
        issues.push(missing(path, 'deviceTypeIdentifier'));
      break;
  }
  return issues;
}

/**
 * Validates cross-field completeness of a parsed TestPlan.
 * Returns all issues found; an empty array means the plan is executable.
 */
export function validateTestPlan(plan: TestPlan): TestPlanValidationIssue[] {
  const issues: TestPlanValidationIssue[] =
    plan.device.kind === 'physical' ? validatePhysical(plan) : validateSimulator(plan);

  if (plan.execution.prefer === 'xcuitest' && plan.execution.xcuitest?.scheme === undefined) {
    issues.push({
      code: 'xcuitest_prefer_without_scheme',
      path: 'execution.xcuitest.scheme',
      message:
        'prefer="xcuitest" requires an explicit execution.xcuitest.scheme (target-explicit, R4)',
    });
  }

  if (plan.execution.resolvedPath === 'xcuitest' && !plan.execution.xcuitest) {
    issues.push({
      code: 'xcuitest_route_without_configuration',
      path: 'execution.xcuitest',
      message: 'resolvedPath="xcuitest" requires a confirmed XCUITest configuration',
    });
  }

  if (plan.execution.resolvedPath === 'device_backend' && plan.execution.xcuitest) {
    issues.push({
      code: 'device_route_with_xcuitest_configuration',
      path: 'execution.xcuitest',
      message: 'a DeviceBackend route must not retain an XCUITest configuration',
    });
  }

  if (plan.execution.prefer !== 'auto' && plan.execution.prefer !== plan.execution.resolvedPath) {
    issues.push({
      code: 'explicit_preference_route_mismatch',
      path: 'execution.resolvedPath',
      message: 'an explicit execution preference must resolve to the same route',
    });
  }

  if (plan.execution.resolvedPath === 'xcuitest' && plan.execution.fallback !== 'abort') {
    issues.push({
      code: 'xcuitest_route_requires_abort',
      path: 'execution.fallback',
      message: 'a resolved XCUITest route is fail-closed and requires fallback="abort"',
    });
  }

  return issues;
}

/** Validates and throws {@link TestPlanValidationError} when issues exist. */
export function assertValidTestPlan(plan: TestPlan): void {
  const issues = validateTestPlan(plan);
  if (issues.length > 0) {
    throw new TestPlanValidationError(issues);
  }
}
