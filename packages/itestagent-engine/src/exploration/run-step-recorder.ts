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

import type { RunStep } from 'itestagent-contracts';
import type { LocatorResult } from './types.js';

// ─── Step Record ────────────────────────────────────────────────

/** Internal state for a step in progress. */
interface StepRecord {
  stepId: string;
  backend: string;
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

  constructor(backend: string) {
    this.backend = backend;
  }

  /**
   * Start recording a new step.
   *
   * @param action - The action type (tap, swipe, input, screenshot, etc.)
   * @param target - Human-readable target description
   * @param locator - LocatorResult from ElementLocator (optional)
   * @returns stepId for use with completeStep/failStep
   */
  startStep(action: string, target: string, locator?: LocatorResult): string {
    this.stepCounter += 1;
    const stepId = `s${this.stepCounter}`;
    const record: StepRecord = {
      stepId,
      backend: this.backend,
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

    this.steps.push({
      stepId: record.stepId,
      backend: record.backend,
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
      result: result ?? { ok: true },
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
  failStep(stepId: string, error: string): void {
    const record = this.active.get(stepId);
    if (!record) return;

    const durationMs = Date.now() - record.startedAt;

    this.steps.push({
      stepId: record.stepId,
      backend: record.backend,
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
      result: {
        error,
        degradation: true,
        ac4_note: 'Element location failed or action was unreliable — explicitly degraded per AC4.',
      },
      artifacts: record.artifacts,
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
