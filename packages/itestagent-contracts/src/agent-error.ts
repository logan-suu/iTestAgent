import { z } from 'zod';

/**
 * Agent 错误码 Schema（Zod）
 *
 * AC 原文（ADR-010 + 架构设计文档 §7.2）：
 *   14 种 AgentErrorCode 覆盖 Agent 执行过程中的所有可恢复/不可恢复错误场景。
 *
 * AGENTS.md §6 领域关键规则：
 *   不确定必标注；敏感数据不落盘明文（R6）。
 *
 * 错误码分类：
 *   blocked.*    = 阻塞性错误（不可自动恢复）
 *   capability.* = 能力缺失
 *   backend.*    = Backend 执行错误
 *   artifact.*   = 产物/数据处理错误
 *   app_state.*  = 应用状态异常
 *   timeout.*    = 超时/不稳定
 *   not_exportable / inconclusive = 无法导出 / 不确定
 */

// ─── AgentErrorCode ──────────────────────────────────────────

/**
 * 14 种 Agent 错误码。
 * 注意：error code 严格保持 kebab-case 点分格式（task 2.3 产出物一致性要求）。
 */
export const AgentErrorCodeSchema = z.enum([
  'blocked.security',
  'blocked.setup',
  'blocked.no_device_available',
  'blocked.cross_target_fallback',
  'blocked.target_unsupported',
  'blocked.privacy',
  'blocked.safety',
  'capability.missing',
  'backend.error',
  'artifact.error',
  'app_state.unexpected',
  'timeout.flaky',
  'not_exportable',
  'inconclusive',
]);

export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>;

// ─── AgentError ──────────────────────────────────────────────

/**
 * Agent 错误对象 Schema。
 * 对应 AgentRuntime 执行过程中产生的结构化错误（区别于原生 Error）。
 *
 * - code   : 12 种结构化错误码之一
 * - message: 人类可读错误描述（禁止包含敏感数据，R6）
 * - details: 可选的补充诊断信息（如 Backend 堆栈摘要）
 * - cause  : 可选的原始错误对象（仅内存传递，不序列化到日志/报告）
 */
export const AgentErrorSchema = z.object({
  /** 结构化错误码 */
  code: AgentErrorCodeSchema,
  /** 人类可读描述 */
  message: z.string(),
  /** 补充诊断信息 */
  details: z.string().optional(),
  /** 原始错误对象（仅内存，不入日志/报告/落盘—R6） */
  cause: z.unknown().optional(),
});

export type AgentError = z.infer<typeof AgentErrorSchema>;

// ─── 工具函数 ────────────────────────────────────────────────

/**
 * 安全解析 AgentError。
 * 非法字段会抛出 ZodError。
 */
export function parseAgentError(raw: unknown): AgentError {
  return AgentErrorSchema.parse(raw);
}
