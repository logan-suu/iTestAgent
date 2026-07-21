import { z } from 'zod';
import { ArtifactRefSchema } from './device-types.js';
import type { ArtifactRef } from './device-types.js';

/**
 * Agent Runtime 类型 Schema（Zod）
 *
 * 来源：ADR-010 §5.6 AgentRuntime interface + §11 ToolCall/ToolResult
 *
 * AGENTS.md §4 架构：
 *   AgentRuntime 包装 AI SDK，负责 stream/event/abort，不直接执行设备命令。
 *   PermissionEngine 是高风险操作唯一入口。
 *   RunStateMachine 与 AgentRuntime 分离，不执行工具。
 *   abort 贯穿 runtime/tool/backend/child process，复用 AbortSignal/Bun.spawn。
 *
 * 红线 R10：不引入 Effect-TS / SQLite 事件溯源等重型编排；不 fork/import OpenCode 私有核心。
 *
 * 本文件定义 L2 层类型——依赖 L1（device-types.ts），被 L3 agent-events.ts 依赖。
 * Phase 1 stub：AgentTurnInput 仅含占位字段；Phase 3 将添加 AI SDK 字段。
 */

// ─── ToolCall ────────────────────────────────────────────────

/**
 * 工具调用 Schema（ADR-010 §11）。
 * 对应 AgentRuntime 触发一次底层 backend tool 调用的请求。
 */
export const ToolCallSchema = z
  .object({
    /** 工具调用唯一标识 */
    id: z.string(),
    /** 工具名称（如 tap、screenshot） */
    name: z.string(),
    /** 工具参数（key-value，值类型由工具自身校验） */
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * 安全解析 ToolCall。
 * 非法字段会抛出 ZodError。
 */
export function parseToolCall(raw: unknown): ToolCall {
  return ToolCallSchema.parse(raw);
}

// ─── ToolResult ──────────────────────────────────────────────

/**
 * 工具执行结果 Schema（ADR-010 §11）。
 * 对应一次 tool call 的返回。
 */
export const ToolResultSchema = z
  .object({
    /** 对应 ToolCall.id */
    callId: z.string(),
    /** 执行状态 */
    status: z.enum(['ok', 'error']),
    /** 工具输出（JSON-serializable） */
    output: z.unknown(),
    /** 关联的产物引用（可选） */
    artifacts: ArtifactRefSchema.array().optional(),
  })
  .strict();

export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * 安全解析 ToolResult。
 * 非法字段会抛出 ZodError。
 */
export function parseToolResult(raw: unknown): ToolResult {
  return ToolResultSchema.parse(raw);
}

// ─── AgentTurnInput (Phase 1 stub) ──────────────────────────

/**
 * Agent 轮次输入 Schema（Phase 1 stub）。
 *
 * Phase 3 将添加 AI SDK 字段（messages: ModelMessage[], tools: ToolSet,
 * stopWhen: StopCondition[], etc.）。当前仅定义占位字段以支撑接口契约。
 */
export const AgentTurnInputSchema = z
  .object({
    /** 消息列表（Phase 3 将细化为 ModelMessage[]） */
    messages: z.array(z.unknown()),
    /** 最大执行步数（可选），正整数 */
    maxSteps: z.number().int().positive().optional(),
    /** System prompt（可选），由 ContextBuilder 注入 */
    system: z.string().optional(),
  })
  .strict();

export type AgentTurnInput = z.infer<typeof AgentTurnInputSchema>;

// ─── AgentEvent (minimal stub — agent-events.ts refines this) ──────

/**
 * Agent 事件（最小 stub）。
 *
 * 真实 AgentEvent 类型定义在 agent-events.ts 中，以 discriminated union 细化。
 * 本文件仅提供最简接口以解除 AgentRuntime 对 agent-events.ts 的循环依赖。
 * 实现类在导入 AgentEvent 时应从 agent-events.ts 导入真实类型。
 *
 * 避坑手册 §2：避免循环依赖——低层模块不得导入高层模块。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AgentEvent {
  /** 事件类型标识（agent-events.ts 中细化为 discriminated union） */
  type: string;
}

// ─── AgentRuntime (TS interface — behavior contract) ─────────

/**
 * AgentRuntime 接口（ADR-010 §5.6）。
 *
 * 行为契约——不定义具体实现，仅约束：
 * 1. streamTurn: 接收 AgentTurnInput，输出 AsyncIterable<AgentEvent>
 * 2. executeToolCall: 同步执行一次 tool call，返回 ToolResult
 * 3. abort: 中断所有进行中的 stream/execution
 *
 * 红线 R7：高风险操作须二次确认（清数据/卸载重装/写项目/存凭证/更新 baseline）。
 * 红线 R10：不引入 Effect-TS 等重型编排。
 */
export interface AgentRuntime {
  /** 发起一次 agent 轮次，返回事件流 */
  streamTurn(input: AgentTurnInput): AsyncIterable<AgentEvent>;

  /** 执行一次 tool call（由 PermissionEngine 鉴权后调用） */
  executeToolCall(call: ToolCall): Promise<ToolResult>;

  /** 中断所有进行中的操作 */
  abort(reason: string): Promise<void>;
}
