import { z } from 'zod';
import { AgentErrorSchema } from './agent-error.js';
import { ToolResultSchema } from './agent-runtime.js';
import { ArtifactRefSchema } from './device-types.js';
import { PermissionEffectSchema } from './permission.js';
import { RunStateSchema } from './run-state.js';

/**
 * Agent 事件类型 Schema（Zod）
 *
 * 来源：架构设计文档 §7.4 AgentEvent chain（16 events）+ ADR-010 §5.6 AgentRuntime
 *
 * AgentRuntime.streamTurn 通过 AsyncIterable<AgentEvent> 输出事件流。
 * 16 个 discriminated union 成员覆盖 session / turn / tool / run / artifact 生命周期。
 *
 * 红线 R10：不引入 Effect-TS / SQLite 事件溯源等重型编排。
 *
 * 本文件定义 L2 层类型——依赖 L1（agent-error.ts, run-state.ts, permission.ts, device-types.ts）
 * 与 L2（agent-runtime.ts），被 engine 的 SSE Hub 消费。
 */

// ─── Event Type Enum ─────────────────────────────────────────

export const AgentEventTypeSchema = z.enum([
  'session.started',
  'turn.started',
  'assistant.delta',
  'tool.requested',
  'permission.requested',
  'permission.resolved',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
  'run.state.changed',
  'artifact.created',
  'turn.completed',
  'session.idle',
  'session.aborted',
  'session.error',
]);

export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

// ─── 1. SessionStartedEvent ──────────────────────────────────

export const SessionStartedEventSchema = z.object({
  type: z.literal('session.started'),
  sessionId: z.string(),
  workspace: z.string(),
  startedAt: z.string(),
});

export type SessionStartedEvent = z.infer<typeof SessionStartedEventSchema>;

// ─── 2. TurnStartedEvent ─────────────────────────────────────

export const TurnStartedEventSchema = z.object({
  type: z.literal('turn.started'),
  turnId: z.string(),
  runId: z.string().optional(),
});

export type TurnStartedEvent = z.infer<typeof TurnStartedEventSchema>;

// ─── 3. AssistantDeltaEvent ──────────────────────────────────

export const AssistantDeltaEventSchema = z.object({
  type: z.literal('assistant.delta'),
  delta: z.string(),
  turnId: z.string(),
});

export type AssistantDeltaEvent = z.infer<typeof AssistantDeltaEventSchema>;

// ─── 4. ToolRequestedEvent ───────────────────────────────────

export const ToolRequestedEventSchema = z.object({
  type: z.literal('tool.requested'),
  callId: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

export type ToolRequestedEvent = z.infer<typeof ToolRequestedEventSchema>;

// ─── 5. PermissionRequestedEvent ──────────────────────────────

export const PermissionRequestedEventSchema = z.object({
  type: z.literal('permission.requested'),
  callId: z.string(),
  action: z.string(),
  resource: z.string(),
});

export type PermissionRequestedEvent = z.infer<typeof PermissionRequestedEventSchema>;

// ─── 6. PermissionResolvedEvent ───────────────────────────────

export const PermissionResolvedEventSchema = z.object({
  type: z.literal('permission.resolved'),
  callId: z.string(),
  effect: PermissionEffectSchema,
});

export type PermissionResolvedEvent = z.infer<typeof PermissionResolvedEventSchema>;

// ─── 7. ToolStartedEvent ─────────────────────────────────────

export const ToolStartedEventSchema = z.object({
  type: z.literal('tool.started'),
  callId: z.string(),
  name: z.string(),
  backend: z.string(),
});

export type ToolStartedEvent = z.infer<typeof ToolStartedEventSchema>;

// ─── 8. ToolProgressEvent ────────────────────────────────────

export const ToolProgressEventSchema = z.object({
  type: z.literal('tool.progress'),
  callId: z.string(),
  message: z.string(),
  percent: z.number().min(0).max(100).optional(),
});

export type ToolProgressEvent = z.infer<typeof ToolProgressEventSchema>;

// ─── 9. ToolCompletedEvent ───────────────────────────────────

export const ToolCompletedEventSchema = z.object({
  type: z.literal('tool.completed'),
  callId: z.string(),
  result: ToolResultSchema,
});

export type ToolCompletedEvent = z.infer<typeof ToolCompletedEventSchema>;

// ─── 10. ToolFailedEvent ─────────────────────────────────────

export const ToolFailedEventSchema = z.object({
  type: z.literal('tool.failed'),
  callId: z.string(),
  error: AgentErrorSchema,
});

export type ToolFailedEvent = z.infer<typeof ToolFailedEventSchema>;

// ─── 11. RunStateChangedEvent ────────────────────────────────

export const RunStateChangedEventSchema = z.object({
  type: z.literal('run.state.changed'),
  runId: z.string(),
  from: RunStateSchema,
  to: RunStateSchema,
  reason: z.string().optional(),
});

export type RunStateChangedEvent = z.infer<typeof RunStateChangedEventSchema>;

// ─── 12. ArtifactCreatedEvent ────────────────────────────────

export const ArtifactCreatedEventSchema = z.object({
  type: z.literal('artifact.created'),
  artifact: ArtifactRefSchema,
});

export type ArtifactCreatedEvent = z.infer<typeof ArtifactCreatedEventSchema>;

// ─── 13. TurnCompletedEvent ──────────────────────────────────

export const TurnCompletedEventSchema = z.object({
  type: z.literal('turn.completed'),
  turnId: z.string(),
  summary: z.string().optional(),
});

export type TurnCompletedEvent = z.infer<typeof TurnCompletedEventSchema>;

// ─── 14. SessionIdleEvent ────────────────────────────────────

export const SessionIdleEventSchema = z.object({
  type: z.literal('session.idle'),
  sessionId: z.string(),
});

export type SessionIdleEvent = z.infer<typeof SessionIdleEventSchema>;

// ─── 15. SessionAbortedEvent ─────────────────────────────────

export const SessionAbortedEventSchema = z.object({
  type: z.literal('session.aborted'),
  sessionId: z.string(),
  reason: z.string(),
});

export type SessionAbortedEvent = z.infer<typeof SessionAbortedEventSchema>;

// ─── 16. SessionErrorEvent ───────────────────────────────────

export const SessionErrorEventSchema = z.object({
  type: z.literal('session.error'),
  sessionId: z.string(),
  error: AgentErrorSchema,
});

export type SessionErrorEvent = z.infer<typeof SessionErrorEventSchema>;

// ─── Discriminated Union ─────────────────────────────────────

export const AgentEventSchema = z.discriminatedUnion('type', [
  SessionStartedEventSchema,
  TurnStartedEventSchema,
  AssistantDeltaEventSchema,
  ToolRequestedEventSchema,
  PermissionRequestedEventSchema,
  PermissionResolvedEventSchema,
  ToolStartedEventSchema,
  ToolProgressEventSchema,
  ToolCompletedEventSchema,
  ToolFailedEventSchema,
  RunStateChangedEventSchema,
  ArtifactCreatedEventSchema,
  TurnCompletedEventSchema,
  SessionIdleEventSchema,
  SessionAbortedEventSchema,
  SessionErrorEventSchema,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ─── Helper Function ─────────────────────────────────────────

/**
 * Check if an AgentEvent is a terminal event (ends the session stream).
 *
 * Terminal events: session.idle, session.aborted, session.error.
 * Once emitted, the SSE stream ends and no further events should be expected.
 */
export function isTerminalEvent(event: AgentEvent): boolean {
  return (
    event.type === 'session.idle' ||
    event.type === 'session.aborted' ||
    event.type === 'session.error'
  );
}
