import {
  type FailureExplanation,
  type RunResult,
  RunResultSchema,
  type RunStatus,
  type TestCaseResult,
  type TestPlan,
  TestPlanSchema,
  createId,
} from 'itestagent-contracts';

export type RerunMode = 'failed_only' | 'all';

export class RerunValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'RerunValidationError';
  }
}

/** Xcode accepts target[/class[/method]] identifiers for -only-testing. */
export function isXcuitestOnlyIdentifier(caseId: string): boolean {
  return /^[^\s/]+\/[^\s/]+(?:\/[^\s/]+)?$/.test(caseId);
}

/** Build a new immutable child plan from a committed parent bundle. */
export function createRerunPlan(input: {
  parentPlan: TestPlan;
  parentResult: RunResult;
  mode: RerunMode;
  runId?: string;
}): TestPlan {
  if (input.parentPlan.runId !== input.parentResult.runId) {
    throw new RerunValidationError(
      'rerun_parent_mismatch',
      'parent plan and result do not share a runId',
    );
  }
  const eligible = input.parentResult.cases.filter((testCase) =>
    input.mode === 'all' ? true : testCase.status === 'failed' || testCase.status === 'flaky',
  );
  if (eligible.length === 0) {
    throw new RerunValidationError(
      'rerun_no_eligible_cases',
      `parent run ${input.parentResult.runId} has no ${input.mode === 'all' ? '' : 'failed or flaky '}cases to rerun`,
    );
  }
  const selectedCaseIds = eligible.map((testCase) => testCase.caseId);
  if (
    input.parentPlan.execution.resolvedPath === 'xcuitest' &&
    selectedCaseIds.some((caseId) => !isXcuitestOnlyIdentifier(caseId))
  ) {
    throw new RerunValidationError(
      'rerun_xcuitest_identifier_unavailable',
      'one or more selected case IDs cannot be mapped to -only-testing identifiers',
    );
  }
  return TestPlanSchema.parse({
    ...structuredClone(input.parentPlan),
    runId: input.runId ?? createId('run'),
    rerun: {
      parentRunId: input.parentResult.runId,
      mode: input.mode,
      selectedCaseIds,
    },
  });
}

function aggregateStatus(cases: readonly TestCaseResult[], fallback: RunStatus): RunStatus {
  if (cases.some((testCase) => testCase.status === 'failed')) return 'failed';
  if (cases.some((testCase) => testCase.status === 'flaky')) return 'flaky';
  return fallback;
}

/** Convert a passing child case after a parent failure into deterministic flaky evidence. */
export function applyRerunFlakiness(input: {
  parent: RunResult;
  child: RunResult;
}): RunResult {
  if (input.child.parentRunId !== input.parent.runId) {
    throw new RerunValidationError(
      'rerun_lineage_mismatch',
      'child parentRunId does not identify the supplied parent result',
    );
  }
  if (input.child.environment.targetKind !== input.parent.environment.targetKind) {
    throw new RerunValidationError('rerun_target_mismatch', 'parent and child targetKind differ');
  }
  const parentCases = new Map(input.parent.cases.map((testCase) => [testCase.caseId, testCase]));
  const transitions: string[] = [];
  const cases = input.child.cases.map((childCase) => {
    const parentCase = parentCases.get(childCase.caseId);
    if (
      childCase.status === 'passed' &&
      (parentCase?.status === 'failed' || parentCase?.status === 'flaky')
    ) {
      transitions.push(
        `${input.parent.runId}:${childCase.caseId}:${parentCase.status}->${input.child.runId}:${childCase.caseId}:passed`,
      );
      return { ...childCase, status: 'flaky' as const };
    }
    return childCase;
  });
  const status = aggregateStatus(cases, input.child.status);
  const explanation: FailureExplanation | undefined =
    transitions.length > 0
      ? {
          explanationType: 'flaky',
          summary: `${transitions.length} case(s) passed on rerun after failing in the direct parent run.`,
          evidence: transitions,
          confidence: 'high',
          suggestedActions: [
            'Repeat the same case to measure recurrence',
            'Inspect timing, asynchronous state, and external dependencies',
          ],
        }
      : input.child.explanation;
  return RunResultSchema.parse({ ...input.child, status, cases, explanation });
}
