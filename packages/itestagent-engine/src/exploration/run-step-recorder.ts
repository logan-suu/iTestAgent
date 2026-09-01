/**
 * RunStepRecorder — records structured RunStep entries during DeviceBackend exploration.
 *
 * Task 3.12 AC3: exploration process fully recorded as RunSteps.
 * Each RunStep contains: stepId, action, target, locator, status,
 * startedAt, durationMs, and artifact references.
 *
 * The recorder maintains an in-memory array of RunStep entries and
 * supports start/complete/fail lifecycle with automatic timing.
 */

import { createId } from 'itestagent-contracts';
import type { RunStep } from 'itestagent-contracts';
import { redactValue } from '../context-builder.js';
import type { LocatorResult } from './types.js';

// ─── Step Record ────────────────────────────────────────────────

/** Internal state for a step in progress. */
interface StepRecord {
  stepId: string;
  sequence: number;
  backend: string;
  targetKind: 'physical' | 'simulator';
  caseId?: string;
  action: string;
  target?: string;
  locator?: LocatorResult;
  startedAt: number; // Date.now() timestamp
  artifacts: string[];
}

// ─── RunStepRecorder ────────────────────────────────────────────

/**
 * RunStepRecorder — records exploration steps as structured RunStep entries.
 *
 * Lifecycle:
 *   startStep()  → returns stepId, records start time
 *   completeStep() → finalizes with success, artifacts
 *   failStep()   → finalizes with failure, degradation note (AC4)
 *
 * Thread-safe for sequential use (exploration is sequential per device).
 */
export class RunStepRecorder {
  private steps: RunStep[] = [];
  private active: Map<string, StepRecord> = new Map();
  private stepCounter = 0;
  private readonly backend: string;
  private readonly targetKind: 'physical' | 'simulator';

  constructor(backend: string, targetKind: 'physical' | 'simulator' = 'physical') {
    this.backend = backend;
    this.targetKind = targetKind;
  }

  /**
   * Start recording a new step.
   *
   * @param action - The action type (tap, swipe, input, screenshot, etc.)
   * @param target - Human-readable target description
   * @param locator - LocatorResult from ElementLocator (optional)
   * @returns stepId for use with completeStep/failStep
   */
  startStep(action: string, target: string, locator?: LocatorResult, caseId?: string): string {
    this.stepCounter += 1;
    const stepId = createId('s');
    const record: StepRecord = {
      stepId,
      sequence: this.stepCounter,
      backend: this.backend,
      targetKind: this.targetKind,
      caseId,
      action,
      target,
      locator,
      startedAt: Date.now(),
      artifacts: [],
    };
    this.active.set(stepId, record);
    return stepId;
  }

  /**
   * Complete a step successfully.
   *
   * @param stepId - The step ID from startStep()
   * @param result - The result value from the tool execution
   * @param artifacts - Artifact IDs to associate with this step
   */
  completeStep(stepId: string, result: unknown, artifacts: string[] = []): void {
    const record = this.active.get(stepId);
    if (!record) return;

    const durationMs = Date.now() - record.startedAt;
    const sanitizedResult = sanitizeUnknown(result);

    this.steps.push({
      stepId: record.stepId,
      sequence: record.sequence,
      backend: record.backend,
      targetKind: record.targetKind,
      caseId: record.caseId,
      action: record.action,
      target: record.target,
      input: {
        target: record.target,
        locator: record.locator
          ? {
              strategy: record.locator.strategy,
              confidence: record.locator.confidence,
              degradation: record.locator.degradation,
            }
          : undefined,
      },
      result: sanitizedResult ?? { ok: true },
      status: 'completed',
      artifacts: [...record.artifacts, ...artifacts],
      startedAt: new Date(record.startedAt).toISOString(),
      durationMs,
    });

    this.active.delete(stepId);
  }

  /**
   * Mark a step as failed, recording degradation per AC4.
   *
   * @param stepId - The step ID from startStep()
   * @param error - The error message or degradation explanation
   */
  failStep(stepId: string, error: string, artifacts: string[] = [], blocked = false): void {
    const record = this.active.get(stepId);
    if (!record) return;

    const durationMs = Date.now() - record.startedAt;

    this.steps.push({
      stepId: record.stepId,
      sequence: record.sequence,
      backend: record.backend,
      targetKind: record.targetKind,
      caseId: record.caseId,
      action: record.action,
      target: record.target,
      input: {
        target: record.target,
        locator: record.locator
          ? {
              strategy: record.locator.strategy,
              confidence: record.locator.confidence,
              degradation: record.locator.degradation,
            }
          : undefined,
      },
      result: sanitizeUnknown({
        error,
        degradation: true,
        ac4_note: 'Element location failed or action was unreliable — explicitly degraded per AC4.',
      }),
      status: blocked ? 'blocked' : 'failed',
      artifacts: [...record.artifacts, ...artifacts],
      startedAt: new Date(record.startedAt).toISOString(),
      durationMs,
    });

    this.active.delete(stepId);
  }

  /**
   * Add an artifact to an active step.
   */
  addArtifact(stepId: string, artifactId: string): void {
    const record = this.active.get(stepId);
    if (record) {
      record.artifacts.push(artifactId);
    }
  }

  /** Link an artifact after a step has completed (used by post-action checkpoints). */
  linkArtifact(stepId: string, artifactId: string): void {
    const active = this.active.get(stepId);
    if (active) {
      active.artifacts.push(artifactId);
      return;
    }
    const completed = this.steps.find((step) => step.stepId === stepId);
    if (completed && !completed.artifacts.includes(artifactId)) {
      completed.artifacts.push(artifactId);
    }
  }

  /**
   * Get all recorded steps so far.
   * Active (incomplete) steps are NOT included.
   */
  getSteps(): RunStep[] {
    return [...this.steps];
  }

  /**
   * Get the count of recorded (completed) steps.
   */
  get stepCount(): number {
    return this.steps.length;
  }

  /**
   * Get the count of active (in-progress) steps.
   */
  get activeCount(): number {
    return this.active.size;
  }

  /**
   * Serialize recorded steps to JSON string.
   */
  toJSON(): string {
    return JSON.stringify(this.steps, null, 2);
  }

  /**
   * Clear all recorded steps.
   */
  reset(): void {
    this.steps = [];
    this.active.clear();
    this.stepCounter = 0;
  }
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return redactValue(value);
    } catch {
      return '[REDACTED]';
    }
  }
  if (typeof value === 'object' && value !== null) {
    try {
      const json = JSON.stringify(value);
      const redacted = redactValue(json);
      return JSON.parse(redacted);
    } catch {
      return '[UNSERIALIZABLE_RESULT_REDACTED]';
    }
  }
  return value;
}
