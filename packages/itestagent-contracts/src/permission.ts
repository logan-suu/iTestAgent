import { z } from 'zod';

/**
 * Permission / Safety Engine Schemas（Zod）
 *
 * ADR-010 §2 PermissionEngine：
 *   PermissionEngine 是高风险操作唯一入口（R7），authz 引擎独立于 AgentRuntime。
 *   PermissionRule 定义 { action, resource, effect } 三元组。
 *
 * AGENTS.md §6 领域关键规则：
 *   高风险操作必须二次确认（清数据/卸载重装/写项目/存凭证/更新 baseline/覆盖 Flow/生成草稿）
 * 红线 R7：危险操作（清除数据/卸载重装/写项目/存凭证/更新 baseline）必须二次确认
 *
 * 架构设计 §8 风险操作列表：
 *   默认高风险动作集 DEFAULT_HIGH_RISK_ACTIONS 包含 9 项。
 */

// ─── 权限效果 ─────────────────────────────────────────────

/**
 * PermissionEffect：单个权限规则的判定结果。
 *   allow — 允许执行
 *   deny  — 拒绝执行
 *   ask   — 需用户确认
 */
export const PermissionEffectSchema = z.enum(['allow', 'deny', 'ask']);

export type PermissionEffect = z.infer<typeof PermissionEffectSchema>;

// ─── 安全门 ───────────────────────────────────────────────

/**
 * SafetyGate：安全门的开闭状态。
 *   allow — 放行（自动执行）
 *   ask   — 询问（跳 TUI 确认框）
 *   deny  — 阻止（直接拒绝并提示）
 */
export const SafetyGateSchema = z.enum(['allow', 'ask', 'deny']);

export type SafetyGate = z.infer<typeof SafetyGateSchema>;

// ─── 权限规则 ─────────────────────────────────────────────

/**
 * PermissionRule：单条权限规则，由 { action, resource, effect } 三元组定义。
 * 对应 ADR-010 §2 PermissionEngine 的 authz 模型。
 */
export const PermissionRuleSchema = z
  .object({
    /** 操作名（如 'clear_app_data'、'uninstall_app'） */
    action: z.string(),
    /** 资源标识（如 bundleId、文件路径、flow id） */
    resource: z.string(),
    /** 此 action + resource 组合的判定结果 */
    effect: PermissionEffectSchema,
  })
  .strict();

export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

// ─── 默认高风险操作集 ─────────────────────────────────────

/**
 * 默认高风险操作列表（9 项）。
 *
 * 架构设计 §8 + 红线 R7 定义：
 *   clear_app_data     — 清除应用数据
 *   uninstall_app      — 卸载应用
 *   write_project_file — 写项目目录文件
 *   store_credential   — 存储凭证
 *   update_baseline    — 更新性能 baseline
 *   overwrite_flow     — 覆盖已有 Flow
 *   generate_draft_test — 生成测试代码草稿
 *   open_non_http_url  — 打开非 HTTP 协议 URL
 *   access_private_media — 访问私有媒体文件
 */
export const DEFAULT_HIGH_RISK_ACTIONS: readonly string[] = [
  'clear_app_data',
  'uninstall_app',
  'write_project_file',
  'store_credential',
  'update_baseline',
  'overwrite_flow',
  'generate_draft_test',
  'open_non_http_url',
  'access_private_media',
];

// ─── 工具函数 ─────────────────────────────────────────────

/**
 * 安全解析单条权限规则。
 * 非法结构会抛出 ZodError。
 */
export function parsePermissionRule(raw: unknown): PermissionRule {
  return PermissionRuleSchema.parse(raw);
}
