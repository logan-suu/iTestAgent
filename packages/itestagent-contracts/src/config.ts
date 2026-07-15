import { z } from 'zod';

/**
 * iTestAgent 配置 Schema（Zod）
 *
 * AC 原文（US-18.2 分层配置 P1）：
 *   AC1 配置路径：~/.itestagent/config/itestagent.jsonc、<project>/.itestagent/itestagent.jsonc、<project>/itestagent.jsonc
 *   AC2 使用 JSONC，支持 $schema
 *   AC3 敏感凭证不写入 JSONC 明文
 *
 * AGENTS.md §5 数据契约：产物必须带 schemaVersion，面向 schema 编码。
 * AGENTS.md §5 配置分层：~/.itestagent/config/itestagent.jsonc < .itestagent/itestagent.jsonc < itestagent.jsonc
 * 红线 R6：敏感数据（账号/OTP/token）不落盘明文、不入日志/报告/提交。
 *
 * 注意：US-18.2 AC3（凭证脱敏 + Keychain 接入）归 task 1.7。
 * 本 schema 只定义 apiKeyRef 字段（存储引用名，不存明文 Key）。
 */

// ─── 模型配置段 ───────────────────────────────────────────

/**
 * US-18.1 AC2：仅需本地依赖 + OpenAI-compatible 模型 API Key。
 * apiKeyRef 存储 Keychain 引用名或环境变量名，不存储明文 API Key（R6）。
 * 凭证存取（Keychain）归 task 1.7。
 */
export const ModelConfigSchema = z
  .object({
    /** OpenAI-compatible provider 名称（如 "openai"、"anthropic"） */
    provider: z.string().optional().default('openai'),
    /** 自定义 API base URL（OpenAI-compatible 端点） */
    baseURL: z.string().optional(),
    /**
     * API Key 的引用名（Keychain key 或环境变量名）。
     * 不存储明文 API Key（R6 / US-18.2 AC3）。
     * 凭证存取归 task 1.7。
     */
    apiKeyRef: z.string().optional(),
    /** 模型名称（如 "gpt-4o"、"claude-3-5-sonnet"） */
    model: z.string().optional(),
  })
  .strict();

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ─── 设备配置段 ───────────────────────────────────────────

/**
 * 技术选型 §9：可插拔 DeviceBackend 架构。
 * Phase 0 横评结论：Appium/WDA MVP 主 backend + MockBackend CI baseline。
 */
export const DeviceConfigSchema = z
  .object({
    /** 首选 DeviceBackend */
    preferredBackend: z.enum(['appium', 'mobile-mcp', 'mock']).optional().default('appium'),
  })
  .strict();

export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

// ─── TUI 配置段 ───────────────────────────────────────────

/**
 * 技术选型 §5：OpenTUI+SolidJS 为目标主线，Ink 为已验证 fallback。
 */
export const TuiConfigSchema = z
  .object({
    /** TUI 框架 */
    framework: z.enum(['opentui', 'ink']).optional().default('opentui'),
  })
  .strict();

export type TuiConfig = z.infer<typeof TuiConfigSchema>;

// ─── 配置根 Schema ───────────────────────────────────────

/**
 * iTestAgent 配置根 Schema。
 * 对应配置文件：itestagent.jsonc
 * 三层合并优先级（后者覆盖前者）：
 *   1. ~/.itestagent/config/itestagent.jsonc（全局）
 *   2. <project>/.itestagent/itestagent.jsonc（项目本地）
 *   3. <project>/itestagent.jsonc（项目根）
 *
 * 注意：嵌套对象用 .optional() + transform 填充默认值，
 * 因为 Zod 4 的 .default({}) 要求完整输出类型。
 */
export const ItestAgentConfigSchema = z
  .object({
    /** 配置 schema 版本（AGENTS.md §5 数据契约） */
    schemaVersion: z.string().default('1.0'),
    /** JSONC $schema 引用（US-18.2 AC2） */
    $schema: z.string().optional(),
    /** 模型配置（US-18.1 AC2） */
    model: ModelConfigSchema.optional(),
    /** 设备配置 */
    device: DeviceConfigSchema.optional(),
    /** TUI 配置 */
    tui: TuiConfigSchema.optional(),
  })
  .strict()
  .transform((data) => ({
    ...data,
    model: data.model ?? ModelConfigSchema.parse({}),
    device: data.device ?? DeviceConfigSchema.parse({}),
    tui: data.tui ?? TuiConfigSchema.parse({}),
  }));

export type ItestAgentConfig = z.infer<typeof ItestAgentConfigSchema>;

// ─── 工具函数 ─────────────────────────────────────────────

/** 默认配置（所有字段取 schema 默认值） */
export const DEFAULT_CONFIG: ItestAgentConfig = ItestAgentConfigSchema.parse({});

/**
 * 安全解析配置，返回带默认值的配置。
 * 非法字段会抛出 ZodError。
 */
export function parseConfig(raw: unknown): ItestAgentConfig {
  return ItestAgentConfigSchema.parse(raw);
}

/**
 * 脱敏配置中的敏感字段（用于展示/日志，R6）。
 * apiKeyRef 不脱敏（它是引用名，不是明文 Key）。
 * 本函数预留给 task 1.7 扩展（届时可能有更多敏感字段）。
 */
export function maskSensitiveFields(config: ItestAgentConfig): ItestAgentConfig {
  // 当前 schema 中无明文敏感字段（apiKeyRef 是引用名）。
  // task 1.7 添加 Keychain 后可能需要扩展。
  return config;
}
