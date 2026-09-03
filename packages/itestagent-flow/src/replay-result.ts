/**
 * Flow replay result types — structured output from FlowReplayEngine.
 *
 * Task 5.2: Flow replay engine produces ReplayResult with per-step
 * pass/fail/skipped/blocked status, evidence refs, and summary.
 *
 * US-9.2 AC2: Supports itestagent run flow <flowId> replay.
 * R5: No silent degradation — not_exportable / locator_not_found explicitly marked.
 *
 * B08 module split: this stays the single home of result SHAPES and step
 * factories; execution concerns live in the sibling modules
 * (replay-types/locator/action-utils/interaction/observation/assertion/
 * step/engine/evidence-writer, ui-tree-redactor).
 */
import type { ArtifactRef } from 'itestagent-contracts';

// ─── Step Result ──────────────────────────────────────────────────

/** Status of a single replayed step. */
export type ReplayStepStatus = 'passed' | 'failed' | 'skipped' | 'blocked';

export type ReplayEvidenceStatus =
  | 'success'
  | 'not_requested'
  | 'not_applicable'
  | 'unsupported'
  | 'failed';

export interface ReplayEvidenceOutcome {
  type: ArtifactRef['type'] | 'checkpoint';
  status: ReplayEvidenceStatus;
  artifact?: ArtifactRef;
  error?: string;
}

/**
 * Result of a single replayed Flow step.
 *
 * R5 compliance: status "skipped" carries a reason; "blocked" carries
 * a reason AND implies the step was skipped due to safety or target incompatibility.
 */
export interface ReplayStepResult {
  /** Stable replay-local step identity. */
  stepId: string;
  /** Strictly increasing 1-based execution sequence. */
  sequence: number;
  /** 0-based index into flow.steps */
  stepIndex: number;
  /** Explicitly selected execution target. */
  targetKind?: 'physical' | 'simulator';
  /** Optional case correlation preserved from FlowStepV2. */
  caseId?: string;
  /** Normalized action from FlowStepV2.action */
  action: string;
  /** Human-readable target from FlowStepV2.target */
  target?: string;
  /** Execution status */
  status: ReplayStepStatus;
  /** Actual wall-clock time when this step began. Omitted for steps never attempted. */
  startedAt?: string;
  /** Wall-clock duration of this step in milliseconds */
  durationMs: number;
  /** Error message (only for failed/blocked steps) */
  error?: string;
  /** Evidence artifacts collected during this step (screenshots, page sources) */
  evidence: ArtifactRef[];
  /** Explicit result for requested, omitted, unsupported, or failed evidence. */
  evidenceOutcomes: ReplayEvidenceOutcome[];
  /** Detail message — supplementary context even for passed steps */
  detail?: string;
}

// ─── Evidence Entry ───────────────────────────────────────────────

/**
 * Lightweight artifact reference for replay evidence.
 *
 * Mirrors ArtifactRef from contracts but is self-contained within the flow package
 * to avoid requiring itestagent-contracts in pure-validate use cases.
 */
export interface ReplayEvidence {
  /** Artifact type identifier */
  type: string;
  /** File path to the artifact */
  path: string;
  /** Optional mime type */
  mimeType?: string;
  /** Human-readable label for this artifact */
  label?: string;
}

// ─── Replay Summary ───────────────────────────────────────────────

/** Aggregate replay statistics. */
export interface ReplaySummary {
  /** Total steps in the flow */
  total: number;
  /** Steps that passed */
  passed: number;
  /** Steps that failed (backend error, timeout, etc.) */
  failed: number;
  /** Steps that were skipped (safetyGate deny, unavailable capability) */
  skipped: number;
  /** Steps that were blocked (targetKind mismatch, unsupported action) */
  blocked: number;
}

// ─── Replay Result ────────────────────────────────────────────────

/**
 * Complete replay result for a single Flow replay execution.
 *
 * US-9.2 AC2: Structured output after itestagent run flow <flowId>.
 */
export interface ReplayResult {
  /** The flowId that was replayed */
  flowId: string;
  /** The targetKind this replay ran against */
  targetKind: 'physical' | 'simulator';
  /** Device UDID/serial used for this replay */
  deviceId: string;
  /** ISO timestamp when replay started */
  startedAt: string;
  /** ISO timestamp when replay completed (or was cancelled) */
  completedAt: string;
  /** Per-step results in execution order */
  steps: ReplayStepResult[];
  /** Aggregate statistics */
  summary: ReplaySummary;
  /** Overall replay status: passed if all steps passed, failed otherwise, blocked if no steps executed */
  overallStatus: 'passed' | 'failed' | 'blocked';
  /** True only when an AbortSignal stopped replay before all steps were attempted. */
  cancelled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Create an empty replay summary.
 */
export function createEmptySummary(total: number): ReplaySummary {
  return { total, passed: 0, failed: 0, skipped: 0, blocked: 0 };
}

/**
 * Create a ReplayStepResult for a passed step.
 */
export function passedStep(
  stepIndex: number,
  action: string,
  target: string | undefined,
  durationMs: number,
  evidence: ArtifactRef[],
  detail?: string,
): ReplayStepResult {
  return {
    stepId: `step-${stepIndex + 1}`,
    sequence: stepIndex + 1,
    stepIndex,
    action,
    target,
    status: 'passed',
    durationMs,
    evidence,
    evidenceOutcomes:
      evidence.length > 0
        ? evidence.map((artifact) => ({ type: artifact.type, status: 'success', artifact }))
        : [{ type: 'checkpoint', status: 'not_applicable' }],
    detail,
  };
}

/**
 * Create a ReplayStepResult for a failed step.
 */
export function failedStep(
  stepIndex: number,
  action: string,
  target: string | undefined,
  durationMs: number,
  error: string,
  evidence: ArtifactRef[],
): ReplayStepResult {
  return {
    stepId: `step-${stepIndex + 1}`,
    sequence: stepIndex + 1,
    stepIndex,
    action,
    target,
    status: 'failed',
    durationMs,
    error,
    evidence,
    evidenceOutcomes:
      evidence.length > 0
        ? evidence.map((artifact) => ({ type: artifact.type, status: 'success', artifact }))
        : [{ type: 'checkpoint', status: 'not_applicable' }],
  };
}

/**
 * Create a ReplayStepResult for a skipped step (safetyGate deny, unavailable capability).
 */
export function skippedStep(
  stepIndex: number,
  action: string,
  target: string | undefined,
  reason: string,
): ReplayStepResult {
  return {
    stepId: `step-${stepIndex + 1}`,
    sequence: stepIndex + 1,
    stepIndex,
    action,
    target,
    status: 'skipped',
    durationMs: 0,
    error: reason,
    evidence: [],
    evidenceOutcomes: [{ type: 'checkpoint', status: 'not_applicable' }],
  };
}

/**
 * Create a ReplayStepResult for a blocked step (targetKind mismatch, unsupported action).
 */
export function blockedStep(
  stepIndex: number,
  action: string,
  target: string | undefined,
  reason: string,
): ReplayStepResult {
  return {
    stepId: `step-${stepIndex + 1}`,
    sequence: stepIndex + 1,
    stepIndex,
    action,
    target,
    status: 'blocked',
    durationMs: 0,
    error: reason,
    evidence: [],
    evidenceOutcomes: [{ type: 'checkpoint', status: 'not_applicable' }],
  };
}

export function correlateReplayStep(
  result: ReplayStepResult,
  input: {
    stepId: string;
    sequence: number;
    targetKind: 'physical' | 'simulator';
    caseId?: string;
    startedAt?: string;
  },
): ReplayStepResult {
  return { ...result, ...input };
}
