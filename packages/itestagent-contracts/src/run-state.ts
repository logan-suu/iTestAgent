import { z } from 'zod';

/**
 * iTestAgent RunState（运行状态机）
 *
 * 架构设计文档 §7.1 RunStateMachine：
 *   一次 run 的生命周期从 created → planning → ... → done，
 *   异常路径可随时跳转至 cancelled / blocked / infra_failed / failed。
 *
 * ADR-010 §3 RunStateMachine：
 *   - RunStateMachine 与 AgentRuntime 分离，不执行工具
 *   - 同设备串行，不同设备并行
 *
 * 状态说明：
 *   FORWARD  (11): created → planning → awaiting_confirm → preparing_device →
 *                    building_installing → executing → collecting →
 *                    parsing → explaining → reported → done
 *   EXCEPTION (4): cancelled, blocked, infra_failed, failed
 *
 * 转移规则：
 *   - Forward chain 按序列逐一前进（每步只能到下一步）
 *   - 任何状态可跳转到任意异常状态
 *   - 异常状态只可转到 done
 *   - done 为终态，无有效转移
 */

// ─── RunState Schema ───────────────────────────────────────

export const RunStateSchema = z.enum([
  // Forward states (11)
  'created',
  'planning',
  'awaiting_confirm',
  'preparing_device',
  'building_installing',
  'executing',
  'collecting',
  'parsing',
  'explaining',
  'reported',
  'done',
  // Exception states (4)
  'cancelled',
  'blocked',
  'infra_failed',
  'failed',
]);

export type RunState = z.infer<typeof RunStateSchema>;

// ─── State Constants ───────────────────────────────────────

/** Forward lifecycle states (11) */
export const RUN_STATE_FORWARD: readonly RunState[] = [
  'created',
  'planning',
  'awaiting_confirm',
  'preparing_device',
  'building_installing',
  'executing',
  'collecting',
  'parsing',
  'explaining',
  'reported',
  'done',
] as const;

/** Exception/error states (4) */
export const RUN_STATE_EXCEPTION: readonly RunState[] = [
  'cancelled',
  'blocked',
  'infra_failed',
  'failed',
] as const;

// ─── Transition Map ────────────────────────────────────────

/**
 * All valid state transitions. Any unlisted from→to pair is invalid.
 *
 * Rules:
 *   - Forward chain: each state → next state + all exception states
 *   - done: terminal, no valid transitions
 *   - Exception states: only → done
 */
export const VALID_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  // Forward chain (10 non-terminal states): next + all exceptions
  created: ['planning', ...RUN_STATE_EXCEPTION],
  planning: ['awaiting_confirm', ...RUN_STATE_EXCEPTION],
  awaiting_confirm: ['preparing_device', ...RUN_STATE_EXCEPTION],
  preparing_device: ['building_installing', ...RUN_STATE_EXCEPTION],
  building_installing: ['executing', ...RUN_STATE_EXCEPTION],
  executing: ['collecting', ...RUN_STATE_EXCEPTION],
  collecting: ['parsing', ...RUN_STATE_EXCEPTION],
  parsing: ['explaining', ...RUN_STATE_EXCEPTION],
  explaining: ['reported', ...RUN_STATE_EXCEPTION],
  reported: ['done', ...RUN_STATE_EXCEPTION],
  // Terminal
  done: [],
  // Exception states → only done
  cancelled: ['done'],
  blocked: ['done'],
  infra_failed: ['done'],
  failed: ['done'],
};

// ─── Helper Functions ──────────────────────────────────────

/**
 * Check if a transition from one state to another is valid.
 */
export function isValidTransition(from: RunState, to: RunState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Check if a state is terminal (no further transitions possible).
 * Terminal states: done, cancelled, blocked, infra_failed, failed.
 */
export function isTerminalState(state: RunState): boolean {
  return state === 'done' || isExceptionState(state);
}

/**
 * Check if a state is an exception/error state.
 * Exception states: cancelled, blocked, infra_failed, failed.
 */
export function isExceptionState(state: RunState): boolean {
  return RUN_STATE_EXCEPTION.includes(state);
}
