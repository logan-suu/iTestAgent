import { z } from 'zod';
import { TargetKindSchema } from './device-types.js';

/**
 * Intent schema — S1 阶段：自然语言 → 结构化意图。
 *
 * 数据流全链路 §4：
 *   Intent { goal, targetHint, targetKind?, deviceHint, features?, metricsHint?, scope }
 *
 * 要点：
 *   - Intent 只是意图草稿，不直接执行
 *   - 缺失关键信息（设备/目标）时在 TUI 追问补全
 *   - Intent 与后续 TestPlan 解耦，便于多轮修改
 */

// ─── Scope ────────────────────────────────────────────────────

/**
 * 测试范围枚举。
 * smoke:    冒烟测试（关键链路快速验证）
 * explore:  探索式测试（无预设路径）
 * full:     完整回归
 * perf:     仅性能采集
 * custom:   用户自定义组合
 */
export const ScopeSchema = z.enum(['smoke', 'explore', 'full', 'perf', 'custom']);

export type Scope = z.infer<typeof ScopeSchema>;

// ─── Intent ───────────────────────────────────────────────────

/**
 * 结构化测试意图。
 *
 * 核心字段（required）:
 *   - goal: 用户原始意图的自然语言提炼（非 sourceText，是去噪后的）。
 *   - features: 匹配到的功能列表（来自 ProjectProfile.features 的 name 或 keyword）。
 *   - metricsRequested: 用户是否要求性能指标。
 *   - scope: 测试范围。
 *   - sourceText: 用户原始输入（审计用途）。
 *
 * 可选字段:
 *   - targetKind: physical | simulator（缺失时触发追问）。
 *   - deviceHint: 用户提到的设备描述（如"本机 iPhone"、"iPhone 14 Plus"）。
 */
export const IntentSchema = z.object({
  /** 提炼后的测试目标描述，如"跑登录冒烟测试" */
  goal: z.string().min(1),
  /** 执行目标类型。缺失时表示需要追问补全。 */
  targetKind: TargetKindSchema.optional(),
  /** 设备提示（如"本机 iPhone"、"iPhone 14 Plus"） */
  deviceHint: z.string().optional(),
  /** 匹配到的 features（来自 ProjectProfile） */
  features: z.array(z.string()),
  /** 是否需要性能指标采集 */
  metricsRequested: z.boolean(),
  /** 测试范围 */
  scope: ScopeSchema,
  /** 用户原始输入（审计，不可篡改） */
  sourceText: z.string().min(1),
});

export type Intent = z.infer<typeof IntentSchema>;

// ─── Clarification ────────────────────────────────────────────

/**
 * 追问项 — 当 Intent 缺失关键信息时，TUI 展示追问用户。
 */
export const ClarificationSchema = z.object({
  /** 人类可读的追问文本 */
  question: z.string().min(1),
  /** 需要补全的 Intent 字段名 */
  field: z.enum(['targetKind', 'deviceHint', 'features', 'scope', 'metricsRequested']),
  /** 可选答案列表（TUI 展示为快捷选项） */
  options: z.array(z.string()).optional(),
});

export type Clarification = z.infer<typeof ClarificationSchema>;

// ─── IntentParseResult ────────────────────────────────────────

/**
 * 完整解析结果 — 所有必要信息已就绪。
 */
export const CompleteResultSchema = z.object({
  status: z.literal('complete'),
  intent: IntentSchema,
});

/**
 * 不完整解析结果 — 缺失关键信息，需在 TUI 追问用户。
 */
export const IncompleteResultSchema = z.object({
  status: z.literal('incomplete'),
  intent: IntentSchema,
  clarificationsNeeded: z.array(ClarificationSchema).min(1),
});

/**
 * Intent 解析结果（有区分联合）。
 *
 * complete:   所有关键字段已填充，可直接进入 S3（TestPlan 编译）。
 * incomplete: 缺失 targetKind 或 features 等信息，TUI 展示追问。
 */
export const IntentParseResultSchema = z.discriminatedUnion('status', [
  CompleteResultSchema,
  IncompleteResultSchema,
]);

export type IntentParseResult = z.infer<typeof IntentParseResultSchema>;
export type CompleteResult = z.infer<typeof CompleteResultSchema>;
export type IncompleteResult = z.infer<typeof IncompleteResultSchema>;

// ─── Parse helper ─────────────────────────────────────────────

/**
 * 安全解析 IntentParseResult。
 * 非法字段抛出 ZodError。
 */
export function parseIntentResult(raw: unknown): IntentParseResult {
  return IntentParseResultSchema.parse(raw);
}
