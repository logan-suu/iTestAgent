import {
  RUN_STATE_EXCEPTION,
  RUN_STATE_FORWARD,
  isTerminalState,
  isValidTransition,
} from 'itestagent-contracts';
import type { RunState, RunStateChangedEvent } from 'itestagent-contracts';

const ALL_RUN_STATES = new Set<string>([...RUN_STATE_FORWARD, ...RUN_STATE_EXCEPTION]);
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
  private currentStates = new Map<string, RunState>();
  private pauseContexts = new Map<string, PauseContext>();
  private onEvent?: StateChangeHandler;

  constructor(options?: { onEvent?: StateChangeHandler }) {
    this.onEvent = options?.onEvent;
  }

  getState(runId: string): RunState | undefined {
    return this.currentStates.get(runId);
  }

  setStateForTesting(runId: string, state: RunState): void {
    this.currentStates.set(runId, state);
  }

  /**
   * Execute a run state transition.
   *
   * Validates against VALID_TRANSITIONS (contract) plus the
   * `blocked → awaiting_confirm` recovery transition.
   * Emits a `run.state.changed` event on success.
   *
   * The state machine tracks current state internally — the caller
   * does NOT need to pass `from` (it is inferred from stored state).
   *
   * @param runId - The run identifier
   * @param to - Target state
   * @param reason - Optional reason for the transition
   * @returns The new state (`to`) on success
   * @throws Error if the transition is invalid or from a terminal state
   */
  transition(
    runId: string,
    fromOrTo: RunState,
    toOrReason?: RunState | string,
    reason?: string,
  ): RunState {
    let from: RunState;
    let to: RunState;
    let isCompatCall = false;

    // Backward-compat: transition(runId, from, to, reason?)
    if (typeof toOrReason === 'string' && ALL_RUN_STATES.has(toOrReason)) {
      from = fromOrTo;
      to = toOrReason as RunState;
      isCompatCall = true;
    } else {
      // New API: transition(runId, to, reason?)
      const stored = this.currentStates.get(runId);
      if (!stored) {
        throw new Error(`Run "${runId}" has no current state — call start() first`);
      }
      from = stored;
      to = fromOrTo;
    }

    const resolvedReason =
      typeof toOrReason === 'string' && !ALL_RUN_STATES.has(toOrReason) ? toOrReason : reason;

    const isRecovery = from === 'blocked' && to === 'awaiting_confirm';
    const isExceptionToDone = isTerminalState(from) && to === 'done';

    if (isTerminalState(from) && !isExceptionToDone && !isRecovery) {
      throw new Error(`Cannot transition from terminal state "${from}" for run "${runId}"`);
    }

    if (!isValidTransition(from, to) && !isRecovery) {
      throw new Error(`Invalid transition for run "${runId}": ${from} → ${to}`);
    }

    this.currentStates.set(runId, to);

    this.emit({
      type: 'run.state.changed',
      runId,
      from,
      to,
      reason: resolvedReason,
    });

    if (to === 'blocked') {
      this.pauseContexts.set(runId, { prePauseState: from, reason: resolvedReason ?? 'paused' });
    }

    if (isRecovery || to === 'done') {
      this.pauseContexts.delete(runId);
    }

    return to;
  }

  // ─── Convenience: Exception Transitions ──────────────────

  cancel(runId: string, fromOrReason?: RunState | string, reason?: string): RunState {
    if (typeof fromOrReason === 'string' && ALL_RUN_STATES.has(fromOrReason)) {
      return this.transition(runId, fromOrReason as RunState, 'cancelled', reason);
    }
    const resolvedReason = typeof fromOrReason === 'string' ? fromOrReason : reason;
    return this.transition(runId, 'cancelled', resolvedReason);
  }

  block(runId: string, fromOrReason?: RunState | string, reason?: string): RunState {
    if (typeof fromOrReason === 'string' && ALL_RUN_STATES.has(fromOrReason)) {
      return this.transition(runId, fromOrReason as RunState, 'blocked', reason);
    }
    const resolvedReason = typeof fromOrReason === 'string' ? fromOrReason : reason;
    return this.transition(runId, 'blocked', resolvedReason);
  }

  fail(runId: string, fromOrReason?: RunState | string, reason?: string): RunState {
    if (typeof fromOrReason === 'string' && ALL_RUN_STATES.has(fromOrReason)) {
      return this.transition(runId, fromOrReason as RunState, 'failed', reason);
    }
    const resolvedReason = typeof fromOrReason === 'string' ? fromOrReason : reason;
    return this.transition(runId, 'failed', resolvedReason);
  }

  infraFail(runId: string, fromOrReason?: RunState | string, reason?: string): RunState {
    if (typeof fromOrReason === 'string' && ALL_RUN_STATES.has(fromOrReason)) {
      return this.transition(runId, fromOrReason as RunState, 'infra_failed', reason);
    }
    const resolvedReason = typeof fromOrReason === 'string' ? fromOrReason : reason;
    return this.transition(runId, 'infra_failed', resolvedReason);
  }

  pause(runId: string, fromOrReason?: RunState | string, reason?: string): RunState {
    if (typeof fromOrReason === 'string' && ALL_RUN_STATES.has(fromOrReason)) {
      return this.transition(runId, fromOrReason as RunState, 'blocked', reason ?? 'paused');
    }
    const resolvedReason = typeof fromOrReason === 'string' ? fromOrReason : reason;
    return this.transition(runId, 'blocked', resolvedReason ?? 'paused');
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
    return this.transition(runId, 'awaiting_confirm', 'resumed');
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
    const state: RunState = 'created';
    this.currentStates.set(runId, state);
    return state;
  }

  cleanup(runId: string): void {
    this.pauseContexts.delete(runId);
    this.currentStates.delete(runId);
  }

  // ─── Private ─────────────────────────────────────────────

  private emit(event: RunStateChangedEvent): void {
    this.onEvent?.(event);
  }
}
