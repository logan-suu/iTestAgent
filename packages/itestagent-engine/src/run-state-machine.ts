import { isTerminalState, isValidTransition } from 'itestagent-contracts';
import type { RunState, RunStateChangedEvent } from 'itestagent-contracts';
import { z } from 'zod';

// ─── Error Level ───────────────────────────────────────────

/**
 * L1-L4 error severity classification.
 *
 * Architecture doc §7.3:
 *   L1 Transient:   auto-retry 3x with exponential backoff
 *   L2 Needs confirm: TUI pause, user fixes, then continue
 *   L3 Blocking:    abort run + output doctor suggestion
 *   L4 Uncertain:   mark inconclusive/explored, do not fabricate
 */
export const ErrorLevelSchema = z.enum(['L1', 'L2', 'L3', 'L4']);

/** Error severity level */
export type ErrorLevel = z.infer<typeof ErrorLevelSchema>;

// ─── L1 Patterns: transient, retry-able ────────────────────

const L1_PATTERNS: readonly RegExp[] = [
  /timed?\s*out|timeout/i,
  /connection.*(refused|reset)/i,
  /temporarily/i,
  /file.*lock/i,
  /element.*not.*found/i,
  /stale.*element/i,
  /too many redirects/i,
] as const;

// ─── L2 Patterns: needs user intervention ──────────────────

const L2_PATTERNS: readonly RegExp[] = [
  /sign(ing|ature).*expir/i,
  /device.*disconnect/i,
  /wda.*port.*conflict/i,
  /provisioning/i,
  /certificate.*(invalid|revoked)/i,
  /trust.*(verify|untrusted)/i,
] as const;

// ─── L3 Patterns: blocking, requires doctor ────────────────

const L3_PATTERNS: readonly RegExp[] = [
  /xcode.*not.*(found|install)/i,
  /developer.*mode/i,
  /no.*simulator.*runtime/i,
  /no.*matching.*backend/i,
  /no.*device.*available/i,
  /build.*fail/i,
  /install.*fail/i,
  /appium.*not.*(found|available)/i,
] as const;

/**
 * Classify an error message and optional error code into L1-L4 severity.
 *
 * Checks L3 first (most severe), then L2, then L1, defaulting to L4.
 * The code parameter provides structured hints from AgentError codes.
 */
export function classifyError(message: string, code?: string): ErrorLevel {
  const combined = `${message} ${code ?? ''}`;

  if (L3_PATTERNS.some((p) => p.test(combined))) return 'L3';
  if (L2_PATTERNS.some((p) => p.test(combined))) return 'L2';
  if (L1_PATTERNS.some((p) => p.test(combined))) return 'L1';

  return 'L4';
}

// ─── Pause Context ─────────────────────────────────────────

/** Internal pause tracking: remembers where the run was before being paused. */
interface PauseContext {
  /** The forward state the run was in before pausing */
  prePauseState: RunState;
  /** Reason for the pause */
  reason: string;
}

// ─── RunStateMachine ───────────────────────────────────────

/** Callback invoked on every successful state transition. */
export type StateChangeHandler = (event: RunStateChangedEvent) => void;

/**
 * Run lifecycle state machine.
 *
 * Validates all state transitions against the contract-defined
 * VALID_TRANSITIONS map, plus one recovery transition
 * (`blocked → awaiting_confirm`) for pause/resume semantics.
 *
 * Architecture references:
 *   - Architecture doc §7.1 RunStateMachine: forward chain + exception branches
 *   - ADR-010 §3: RunStateMachine separated from AgentRuntime, no tool execution
 *   - Architecture doc §7.3: L1-L4 error classification
 *
 * Pause/resume semantics:
 *   - `pause()` transitions to `blocked` (valid from any forward state),
 *     saving the pre-pause state internally.
 *   - `resume()` transitions from `blocked` to `awaiting_confirm`
 *     (the re-confirmation checkpoint). After resume, the user must
 *     confirm the plan before execution proceeds.
 *   - This `blocked → awaiting_confirm` transition is a RECOVERY
 *     transition specific to the RunStateMachine implementation;
 *     it is NOT in the contract-level VALID_TRANSITIONS.
 */
export class RunStateMachine {
  private pauseContexts = new Map<string, PauseContext>();
  private onEvent?: StateChangeHandler;

  /**
   * @param options.onEvent - Optional callback for state change events.
   *   Fires synchronously on every successful transition.
   */
  constructor(options?: { onEvent?: StateChangeHandler }) {
    this.onEvent = options?.onEvent;
  }

  // ─── Core Transition ─────────────────────────────────────

  /**
   * Execute a run state transition.
   *
   * Validates against VALID_TRANSITIONS (contract) plus the
   * `blocked → awaiting_confirm` recovery transition.
   * Emits a `run.state.changed` event on success.
   *
   * @param runId - The run identifier (for event tracking)
   * @param from - Current state
   * @param to - Target state
   * @param reason - Optional reason for the transition
   * @returns The new state (`to`) on success
   * @throws Error if the transition is invalid or from a terminal state
   */
  transition(runId: string, from: RunState, to: RunState, reason?: string): RunState {
    // Allow blocked → awaiting_confirm as a recovery transition (pause → resume)
    const isRecovery = from === 'blocked' && to === 'awaiting_confirm';
    // Exception states can only go to done (handled by isValidTransition)
    const isExceptionToDone = isTerminalState(from) && to === 'done';

    // Terminal state check (before validity check for better error messages)
    // Exception → done IS valid; blocked → awaiting_confirm is recovery
    if (isTerminalState(from) && !isExceptionToDone && !isRecovery) {
      throw new Error(`Cannot transition from terminal state "${from}" for run "${runId}"`);
    }

    if (!isValidTransition(from, to) && !isRecovery) {
      throw new Error(`Invalid transition for run "${runId}": ${from} → ${to}`);
    }

    this.emit({
      type: 'run.state.changed',
      runId,
      from,
      to,
      reason,
    });

    // Track pause context when entering blocked
    if (to === 'blocked') {
      this.pauseContexts.set(runId, {
        prePauseState: from,
        reason: reason ?? 'paused',
      });
    }

    // Clear pause context on recovery
    if (isRecovery) {
      this.pauseContexts.delete(runId);
    }

    return to;
  }

  // ─── Convenience: Exception Transitions ──────────────────

  /** Transition to `cancelled` (user-triggered abort). */
  cancel(runId: string, from: RunState, reason?: string): RunState {
    return this.transition(runId, from, 'cancelled', reason);
  }

  /** Transition to `blocked` (needs user intervention). */
  block(runId: string, from: RunState, reason?: string): RunState {
    return this.transition(runId, from, 'blocked', reason);
  }

  /** Transition to `failed` (execution error). */
  fail(runId: string, from: RunState, reason?: string): RunState {
    return this.transition(runId, from, 'failed', reason);
  }

  /** Transition to `infra_failed` (infrastructure error: build, signing, device). */
  infraFail(runId: string, from: RunState, reason?: string): RunState {
    return this.transition(runId, from, 'infra_failed', reason);
  }

  // ─── Pause / Resume ──────────────────────────────────────

  /**
   * Pause a run: transition to `blocked` and save the pre-pause state.
   *
   * Architecture doc §7.3 L2: "TUI 暂停，用户修复后继续"
   *
   * @param runId - Run identifier
   * @param from - Current forward state
   * @param reason - Why the run is pausing (default: "paused")
   */
  pause(runId: string, from: RunState, reason?: string): RunState {
    return this.transition(runId, from, 'blocked', reason ?? 'paused');
  }

  /**
   * Resume a paused run: `blocked → awaiting_confirm`.
   *
   * After resume, the user must confirm the plan before the machine
   * proceeds to `preparing_device`.
   *
   * @throws Error if the run is not currently paused
   */
  resume(runId: string): RunState {
    if (!this.isPaused(runId)) {
      throw new Error(`Run "${runId}" is not paused`);
    }
    return this.transition(runId, 'blocked', 'awaiting_confirm', 'resumed');
  }

  // ─── Pause Context Queries ───────────────────────────────

  /**
   * Get the state the run was in before it was paused.
   * @returns PauseContext or undefined if not paused.
   */
  getPauseContext(runId: string): PauseContext | undefined {
    return this.pauseContexts.get(runId);
  }

  /** Check whether a run is currently paused (tracked internally). */
  isPaused(runId: string): boolean {
    return this.pauseContexts.has(runId);
  }

  // ─── Lifecycle ───────────────────────────────────────────

  /**
   * Enter the initial state for a new run.
   * This is NOT a transition — it sets the starting point.
   */
  start(runId: string): RunState {
    return 'created';
  }

  /** Clear all internal tracking state for a run. Idempotent. */
  cleanup(runId: string): void {
    this.pauseContexts.delete(runId);
  }

  // ─── Private ─────────────────────────────────────────────

  private emit(event: RunStateChangedEvent): void {
    this.onEvent?.(event);
  }
}
