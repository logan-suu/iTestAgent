/**
 * json-schema-cross-field.ts — cross-field / cross-document validation for
 * the result + artifact-index pair (promotion guide §11.4
 * "result+artifact-index→B03", §16 G1).
 *
 * The per-document Zod object schemas (RunResultSchema, ArtifactIndexSchema)
 * and their published draft-07 JSON Schemas can only constrain ONE document
 * at a time. The rules enforced here span fields within a document and the
 * two documents of a report pair, which neither schema language expresses:
 *
 *   - artifact ids must be unique inside one ArtifactIndex;
 *   - caseIds must be unique inside RunResult.cases;
 *   - artifactRefs entries must be unique inside one RunResult;
 *   - the paired RunResult and ArtifactIndex must carry the SAME runId
 *     (cross-document binding);
 *   - every RunResult.artifactRefs entry must resolve to an artifact id in
 *     the paired index.
 *
 * Accept/reject equivalence with the published schemas is unaffected: these
 * checks run ON TOP of already-parsed documents.
 */
import type { ArtifactIndex } from './artifact-index-contract.js';
import { ArtifactIndexSchema } from './artifact-index-contract.js';
import type { FlowReplayPlan } from './flow-replay-plan.js';
import { FlowReplayPlanSchema } from './flow-replay-plan.js';
import type { RunResult } from './run-result-contracts.js';
import { RunResultSchema } from './run-result-contracts.js';
import type { RunStepsDocument } from './run-steps-contract.js';
import { RunStepsDocumentSchema } from './run-steps-contract.js';
import type { TestPlan } from './test-plan.js';
import { TestPlanSchema } from './test-plan.js';

// ─── Types ───────────────────────────────────────────────────

/** A single cross-field violation, located by dotted/bracketed path. */
export interface CrossFieldIssue {
  /** Location of the violation, e.g. "artifacts[2].id" or "runId". */
  path: string;
  /** Human-readable description of the violation. */
  message: string;
}

/** Error raised when a document pair violates a cross-field rule. */
export class CrossFieldValidationError extends Error {
  readonly issues: readonly CrossFieldIssue[];

  constructor(issues: readonly CrossFieldIssue[]) {
    super(
      `cross-field validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'}): ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'CrossFieldValidationError';
    this.issues = issues;
  }
}

// ─── Duplicate detection ─────────────────────────────────────

/** Returns ids that appear more than once in the index, first-seen order. */
export function findDuplicateArtifactIds(index: ArtifactIndex): string[] {
  return findDuplicates(index.artifacts.map((artifact) => artifact.id));
}

/** Returns caseIds that appear more than once in result.cases. */
export function findDuplicateCaseIds(result: RunResult): string[] {
  return findDuplicates(result.cases.map((testCase) => testCase.caseId));
}

/** Returns refs that appear more than once in result.artifactRefs. */
export function findDuplicateArtifactRefs(result: RunResult): string[] {
  return findDuplicates(result.artifactRefs);
}

/** Shared first-seen duplicate scan over a string list. */
function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      if (!duplicates.includes(value)) duplicates.push(value);
    } else {
      seen.add(value);
    }
  }
  return duplicates;
}

// ─── Pair validation ─────────────────────────────────────────

/**
 * Returns artifactRefs entries that resolve to no artifact id in the index.
 * Index entries not referenced from artifactRefs are allowed (step-level
 * artifacts need not be hoisted into the top-level ref list).
 */
export function findUnresolvedArtifactRefs(result: RunResult, index: ArtifactIndex): string[] {
  const knownIds = new Set(index.artifacts.map((artifact) => artifact.id));
  return result.artifactRefs.filter((ref) => !knownIds.has(ref));
}

/**
 * Validates the full RunResult ↔ ArtifactIndex pair. Returns all violations
 * (empty array = valid pair). Checks:
 *   runId binding, duplicate artifact ids, duplicate caseIds,
 *   duplicate artifactRefs, unresolved artifactRefs.
 */
export function validateRunResultArtifactIndexPair(
  result: RunResult,
  index: ArtifactIndex,
): CrossFieldIssue[] {
  const issues: CrossFieldIssue[] = [];

  if (result.runId !== index.runId) {
    issues.push({
      path: 'runId',
      message: `artifact-index runId "${index.runId}" does not match result runId "${result.runId}"`,
    });
  }

  for (const id of findDuplicateArtifactIds(index)) {
    issues.push({
      path: `artifacts[id=${id}]`,
      message: `duplicate artifact id "${id}" in artifact-index`,
    });
  }

  for (const caseId of findDuplicateCaseIds(result)) {
    issues.push({
      path: `cases[caseId=${caseId}]`,
      message: `duplicate caseId "${caseId}" in result.cases`,
    });
  }

  for (const ref of findDuplicateArtifactRefs(result)) {
    issues.push({
      path: `artifactRefs[${ref}]`,
      message: `duplicate artifactRef "${ref}" in result.artifactRefs`,
    });
  }

  for (const ref of findUnresolvedArtifactRefs(result, index)) {
    issues.push({
      path: `artifactRefs[${ref}]`,
      message: `artifactRef "${ref}" resolves to no artifact id in the artifact-index`,
    });
  }

  return issues;
}

/**
 * Throws CrossFieldValidationError if the parsed pair violates any
 * cross-field rule; returns silently otherwise.
 */
export function assertValidRunResultArtifactIndexPair(
  result: RunResult,
  index: ArtifactIndex,
): void {
  const issues = validateRunResultArtifactIndexPair(result, index);
  if (issues.length > 0) {
    throw new CrossFieldValidationError(issues);
  }
}

/**
 * Parses both raw documents (ZodError on structural violations), then
 * enforces the cross-field rules. Returns both parsed documents.
 */
export function parseValidatedRunResultPair(
  rawResult: unknown,
  rawIndex: unknown,
): { result: RunResult; artifactIndex: ArtifactIndex } {
  const result = RunResultSchema.parse(rawResult);
  const artifactIndex = ArtifactIndexSchema.parse(rawIndex);
  assertValidRunResultArtifactIndexPair(result, artifactIndex);
  return { result, artifactIndex };
}

export type RunPlanDocument = TestPlan | FlowReplayPlan;

export interface RunBundleDocuments {
  plan: RunPlanDocument;
  steps: RunStepsDocument;
  result: RunResult;
  artifactIndex: ArtifactIndex;
}

function parseRunPlanDocument(raw: unknown): RunPlanDocument {
  const version =
    typeof raw === 'object' && raw !== null && 'schemaVersion' in raw
      ? (raw as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (version === 'itestagent.test-plan.v3') return TestPlanSchema.parse(raw);
  if (version === 'itestagent.flow-replay-plan.v1') return FlowReplayPlanSchema.parse(raw);
  throw new CrossFieldValidationError([
    {
      path: 'plan.schemaVersion',
      message: `unsupported run plan schemaVersion "${String(version)}"`,
    },
  ]);
}

/** Validates references and conditional fields across a complete committed run bundle. */
export function validateRunBundleDocuments(bundle: RunBundleDocuments): CrossFieldIssue[] {
  const { plan, steps, result, artifactIndex } = bundle;
  const issues = validateRunResultArtifactIndexPair(result, artifactIndex);
  const expectedRunId = result.runId;

  for (const [path, actual] of [
    ['plan.runId', plan.runId],
    ['steps.runId', steps.runId],
  ] as const) {
    if (actual !== expectedRunId) {
      issues.push({
        path,
        message: `runId "${actual}" does not match result runId "${expectedRunId}"`,
      });
    }
  }

  if (plan.schemaVersion === 'itestagent.test-plan.v3') {
    if (!result.projectProfileRef) {
      issues.push({
        path: 'result.projectProfileRef',
        message: 'TestPlan bundle requires projectProfileRef',
      });
    } else if (result.projectProfileRef !== plan.projectProfileRef) {
      issues.push({
        path: 'result.projectProfileRef',
        message: 'projectProfileRef does not match plan.projectProfileRef',
      });
    }
    if (result.execution.mode !== plan.execution.resolvedPath) {
      issues.push({
        path: 'result.execution.mode',
        message: 'execution mode does not match the resolved TestPlan path',
      });
    }
    if (result.execution.targetKind !== plan.device.kind) {
      issues.push({
        path: 'result.execution.targetKind',
        message: 'targetKind does not match the TestPlan device kind',
      });
    }
    if (plan.rerun) {
      if (result.parentRunId !== plan.rerun.parentRunId) {
        issues.push({
          path: 'result.parentRunId',
          message: 'rerun result parentRunId must match plan.rerun.parentRunId',
        });
      }
      const selected = new Set(plan.rerun.selectedCaseIds);
      for (const testCase of result.cases) {
        if (!selected.has(testCase.caseId)) {
          issues.push({
            path: `result.cases[${testCase.caseId}]`,
            message: 'rerun result contains a case outside plan.rerun.selectedCaseIds',
          });
        }
      }
      if (
        ['passed', 'failed', 'flaky', 'explored', 'inconclusive', 'needs_assertion'].includes(
          result.status,
        )
      ) {
        const resultCases = new Set(result.cases.map((testCase) => testCase.caseId));
        for (const caseId of selected) {
          if (!resultCases.has(caseId)) {
            issues.push({
              path: 'result.cases',
              message: `completed rerun result is missing selected case "${caseId}"`,
            });
          }
        }
      }
    } else if (result.parentRunId !== undefined) {
      issues.push({
        path: 'result.parentRunId',
        message: 'ordinary TestPlan bundle must not claim parentRunId',
      });
    }
  } else if (result.projectProfileRef !== undefined) {
    issues.push({
      path: 'result.projectProfileRef',
      message: 'FlowReplayPlan bundle must not claim projectProfileRef',
    });
  } else {
    if (result.parentRunId !== undefined) {
      issues.push({
        path: 'result.parentRunId',
        message: 'FlowReplayPlan bundle must not claim rerun parentRunId',
      });
    }
    if (result.execution.mode !== 'device_backend') {
      issues.push({
        path: 'result.execution.mode',
        message: 'FlowReplayPlan requires device_backend execution mode',
      });
    }
    if (result.execution.targetKind !== plan.target.targetKind) {
      issues.push({
        path: 'result.execution.targetKind',
        message: 'targetKind does not match FlowReplayPlan target',
      });
    }
    if (result.execution.deviceId !== plan.target.deviceId) {
      issues.push({
        path: 'result.execution.deviceId',
        message: 'deviceId does not match FlowReplayPlan target',
      });
    }
    if (
      plan.selection.status === 'selected' &&
      result.execution.backendUsed !== plan.selection.backend
    ) {
      issues.push({
        path: 'result.execution.backendUsed',
        message: 'backendUsed does not match the selected FlowReplayPlan backend',
      });
    }
    if (plan.selection.status === 'failed' && result.execution.backendUsed !== 'unavailable') {
      issues.push({
        path: 'result.execution.backendUsed',
        message: 'failed FlowReplayPlan selection must use unavailable backend semantics',
      });
    }
  }

  const stepById = new Map(steps.steps.map((step) => [step.stepId, step]));
  const caseById = new Map(result.cases.map((testCase) => [testCase.caseId, testCase]));
  const caseIds = new Set(caseById.keys());
  const artifactById = new Map(artifactIndex.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const testCase of result.cases) {
    for (const stepId of testCase.steps) {
      const step = stepById.get(stepId);
      if (!step) {
        issues.push({
          path: `result.cases[${testCase.caseId}].steps`,
          message: `unresolved stepId "${stepId}"`,
        });
      } else if (step.caseId !== testCase.caseId) {
        issues.push({
          path: `result.cases[${testCase.caseId}].steps`,
          message: `stepId "${stepId}" belongs to case "${String(step.caseId)}"`,
        });
      }
    }
    for (const artifactId of testCase.artifacts) {
      const artifact = artifactById.get(artifactId);
      if (!artifact) {
        issues.push({
          path: `result.cases[${testCase.caseId}].artifacts`,
          message: `unresolved artifactId "${artifactId}"`,
        });
      } else if (artifact.relatedCase !== testCase.caseId) {
        issues.push({
          path: `result.cases[${testCase.caseId}].artifacts`,
          message: `artifactId "${artifactId}" does not refer back to case "${testCase.caseId}"`,
        });
      }
    }
  }

  for (const step of steps.steps) {
    if (step.caseId && !caseIds.has(step.caseId)) {
      issues.push({
        path: `steps[${step.stepId}].caseId`,
        message: `unresolved caseId "${step.caseId}"`,
      });
    } else if (step.caseId && !caseById.get(step.caseId)?.steps.includes(step.stepId)) {
      issues.push({
        path: `steps[${step.stepId}].caseId`,
        message: `case "${step.caseId}" does not refer back to step "${step.stepId}"`,
      });
    }
    for (const artifactId of step.artifacts) {
      const artifact = artifactById.get(artifactId);
      if (!artifact) {
        issues.push({
          path: `steps[${step.stepId}].artifacts`,
          message: `unresolved artifactId "${artifactId}"`,
        });
      } else if (artifact.relatedStep !== step.stepId) {
        issues.push({
          path: `steps[${step.stepId}].artifacts`,
          message: `artifactId "${artifactId}" does not refer back to step "${step.stepId}"`,
        });
      }
    }
  }

  for (const artifact of artifactIndex.artifacts) {
    if (artifact.relatedStep && !stepById.has(artifact.relatedStep)) {
      issues.push({
        path: `artifacts[${artifact.id}].relatedStep`,
        message: `unresolved stepId "${artifact.relatedStep}"`,
      });
    } else if (
      artifact.relatedStep &&
      !stepById.get(artifact.relatedStep)?.artifacts.includes(artifact.id)
    ) {
      issues.push({
        path: `artifacts[${artifact.id}].relatedStep`,
        message: `step "${artifact.relatedStep}" does not refer back to artifact "${artifact.id}"`,
      });
    }
    if (artifact.relatedCase && !caseIds.has(artifact.relatedCase)) {
      issues.push({
        path: `artifacts[${artifact.id}].relatedCase`,
        message: `unresolved caseId "${artifact.relatedCase}"`,
      });
    } else if (
      artifact.relatedCase &&
      !caseById.get(artifact.relatedCase)?.artifacts.includes(artifact.id)
    ) {
      issues.push({
        path: `artifacts[${artifact.id}].relatedCase`,
        message: `case "${artifact.relatedCase}" does not refer back to artifact "${artifact.id}"`,
      });
    }
    if (artifact.relatedStep && artifact.relatedCase) {
      const owner = stepById.get(artifact.relatedStep);
      if (owner && owner.caseId !== artifact.relatedCase) {
        issues.push({
          path: `artifacts[${artifact.id}]`,
          message: `related step belongs to case "${String(owner.caseId)}", not "${artifact.relatedCase}"`,
        });
      }
    }
  }

  for (const outcome of artifactIndex.collectionOutcomes) {
    if (outcome.artifactId) {
      const artifact = artifactById.get(outcome.artifactId);
      if (!artifact) {
        issues.push({
          path: 'collectionOutcomes.artifactId',
          message: `unresolved artifactId "${outcome.artifactId}"`,
        });
      } else {
        if (artifact.type !== outcome.type) {
          issues.push({
            path: 'collectionOutcomes.type',
            message: `outcome type "${outcome.type}" does not match artifact type "${artifact.type}"`,
          });
        }
        if (outcome.relatedStep && artifact.relatedStep !== outcome.relatedStep) {
          issues.push({
            path: 'collectionOutcomes.relatedStep',
            message: `outcome step "${outcome.relatedStep}" does not match its artifact`,
          });
        }
        if (outcome.relatedCase && artifact.relatedCase !== outcome.relatedCase) {
          issues.push({
            path: 'collectionOutcomes.relatedCase',
            message: `outcome case "${outcome.relatedCase}" does not match its artifact`,
          });
        }
      }
    }
    if (outcome.relatedStep && !stepById.has(outcome.relatedStep)) {
      issues.push({
        path: 'collectionOutcomes.relatedStep',
        message: `unresolved stepId "${outcome.relatedStep}"`,
      });
    }
    if (outcome.relatedCase && !caseIds.has(outcome.relatedCase)) {
      issues.push({
        path: 'collectionOutcomes.relatedCase',
        message: `unresolved caseId "${outcome.relatedCase}"`,
      });
    }
  }

  const reachableArtifactIds = new Set([
    ...result.artifactRefs,
    ...result.cases.flatMap((testCase) => testCase.artifacts),
    ...steps.steps.flatMap((step) => step.artifacts),
    ...artifactIndex.collectionOutcomes.flatMap((outcome) =>
      outcome.artifactId ? [outcome.artifactId] : [],
    ),
  ]);
  for (const artifact of artifactIndex.artifacts) {
    if (!reachableArtifactIds.has(artifact.id)) {
      issues.push({
        path: `artifacts[${artifact.id}]`,
        message: `artifact "${artifact.id}" is unreachable from result, case, step, or outcome`,
      });
    }
  }

  return issues;
}

export function assertValidRunBundleDocuments(bundle: RunBundleDocuments): void {
  const issues = validateRunBundleDocuments(bundle);
  if (issues.length > 0) throw new CrossFieldValidationError(issues);
}

export function parseValidatedRunBundle(raw: {
  plan: unknown;
  steps: unknown;
  result: unknown;
  artifactIndex: unknown;
}): RunBundleDocuments {
  const bundle: RunBundleDocuments = {
    plan: parseRunPlanDocument(raw.plan),
    steps: RunStepsDocumentSchema.parse(raw.steps),
    result: RunResultSchema.parse(raw.result),
    artifactIndex: ArtifactIndexSchema.parse(raw.artifactIndex),
  };
  assertValidRunBundleDocuments(bundle);
  return bundle;
}
