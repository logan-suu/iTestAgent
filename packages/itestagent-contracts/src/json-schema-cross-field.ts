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
import type { RunResult } from './run-result-contracts.js';
import { RunResultSchema } from './run-result-contracts.js';

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
