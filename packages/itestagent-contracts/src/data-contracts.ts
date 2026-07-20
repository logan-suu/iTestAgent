import { z } from 'zod';
import { TargetKindSchema } from './device-types.js';
import { BaselineDeltaSchema } from './performance-backend.js';

/**
 * iTestAgent Core Data Contracts（Zod）
 *
 * 架构设计文档 §6.3-§6.6 + 数据流全链路 S6-S9：
 *   定义 RunStep、RunResult、ArtifactIndex 及配套的嵌套 schema，
 *   所有产物均带 schemaVersion，面向 schema 编码。
 *
 * AGENTS.md §5 数据契约：
 *   产物必须带 schemaVersion；report 固定三件套 summary.md + result.json + artifact-index.json。
 */

// ─── Constants ───────────────────────────────────────────────

/** Default schema version for all output artifacts */
export const DEFAULT_SCHEMA_VERSION = '2.0';

// ─── RunStatus ───────────────────────────────────────────────

/**
 * Run 最终状态枚举。
 * 对应架构设计文档 §6.5 RunResult + AGENTS.md §6 领域规则。
 *
 *   passed          — 所有断言通过
 *   failed          — 至少一个断言失败
 *   explored        — 只探索未断言
 *   inconclusive    — 无法确定结果（R5 强制标注）
 *   needs_assertion — 需要用户添加断言
 *   flaky           — 结果不稳定
 *   blocked         — 被阻塞（infra / permission 等）
 */
export const RunStatusSchema = z.enum([
  'passed',
  'failed',
  'explored',
  'inconclusive',
  'needs_assertion',
  'flaky',
  'blocked',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

// ─── PerformanceMetrics ──────────────────────────────────────

/**
 * 归一化性能指标 Schema。
 *
 * 红线 R5：不静默降级/臆造指标。不确定项须 approximate: true 显式标注。
 * 技术选型 §11：主推 hitches/hangs/launch/memory/crash/duration；FPS 标 approximate。
 */
export const PerformanceMetricsSchema = z.object({
  /** 启动耗时（毫秒），非负整数 */
  launchDurationMs: z.number().int().nonnegative().optional(),
  /** 内存峰值（MB），非负数 */
  memoryPeakMB: z.number().nonnegative().optional(),
  /** 是否检测到 crash */
  crashDetected: z.boolean().optional(),
  /** 卡顿次数，非负整数 */
  hangCount: z.number().int().nonnegative().optional(),
  /** hitches 摘要级别 */
  hitchesSummary: z.enum(['low', 'medium', 'high', 'inconclusive']).optional(),
  /** FPS 近似值，非负数 */
  fpsApproximate: z.number().nonnegative().optional(),
  /** 是否有指标为近似/估算值（R5 强制标注） */
  approximate: z.boolean().optional(),
  /** 原始 trace 文件路径（可选），用于后续 drill-down */
  rawTracePath: z.string().optional(),
});

export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

// ─── ExecutionSummary ────────────────────────────────────────

/**
 * 执行摘要 Schema。
 * 对应 RunResult 中的 execution 字段。
 */
export const ExecutionSummarySchema = z.object({
  /** 总步骤数，非负整数 */
  totalSteps: z.number().int().nonnegative(),
  /** 已完成步骤数，非负整数 */
  completedSteps: z.number().int().nonnegative(),
  /** 失败步骤数，非负整数 */
  failedSteps: z.number().int().nonnegative(),
  /** 跳过步骤数，非负整数 */
  skippedSteps: z.number().int().nonnegative(),
  /** 执行耗时（毫秒），非负整数 */
  durationMs: z.number().int().nonnegative(),
  /** 开始时间（ISO 8601） */
  startTime: z.string(),
  /** 结束时间（ISO 8601） */
  endTime: z.string(),
  /** 执行模式（ADR-011） */
  mode: z.enum(['xcuitest', 'device_backend']).optional(),
  /** 目标类型（ADR-011） */
  targetKind: TargetKindSchema,
  /** 使用的 backend 名称 */
  backendUsed: z.string(),
  /** backend 版本（审计用途） */
  backendVersion: z.string().optional(),
  /** 目标设备 ID */
  deviceId: z.string(),
});

export type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;

// ─── TestCaseResult ──────────────────────────────────────────

/**
 * 单个测试用例结果 Schema。
 */
export const TestCaseResultSchema = z.object({
  /** 用例唯一标识 */
  caseId: z.string(),
  /** 用例名称 */
  name: z.string(),
  /** 执行状态 */
  status: RunStatusSchema,
  /** 关联步骤 ID 列表 */
  steps: z.array(z.string()),
  /** 用例执行耗时（毫秒），非负整数 */
  durationMs: z.number().int().nonnegative(),
  /** 错误信息（可选，失败时填充） */
  error: z.string().optional(),
  /** 产物 ID 列表（引用，非完整 ArtifactRef） */
  artifacts: z.array(z.string()),
});

export type TestCaseResult = z.infer<typeof TestCaseResultSchema>;

// ─── FailureExplanation ──────────────────────────────────────

/**
 * 失败解释 Schema。
 * 对应架构设计文档 §6.5 RunResult.explanation + itestagent explain 命令。
 */
export const FailureExplanationSchema = z.object({
  /** 失败分类 */
  explanationType: z.enum([
    'product_regression',
    'script_issue',
    'device_issue',
    'env_issue',
    'flaky',
    'perf_regression',
    'inconclusive',
  ]),
  /** 失败摘要（人类可读） */
  summary: z.string(),
  /** 支撑证据列表（artifact ID 或 log 摘要） */
  evidence: z.array(z.string()),
  /** 修复建议（可选） */
  suggestion: z.string().optional(),
  /** 置信度（可选） */
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export type FailureExplanation = z.infer<typeof FailureExplanationSchema>;

// ─── RunStep ─────────────────────────────────────────────────

/**
 * 单个运行步骤 Schema。
 * 对应架构设计文档 §6.3 RunStep（探索/执行原子单元）。
 */
export const RunStepSchema = z.object({
  /** 步骤唯一标识 */
  stepId: z.string(),
  /** 执行此步骤的 backend 名称 */
  backend: z.string(),
  /** 动作类型 */
  action: z.string(),
  /** 动作目标（可选） */
  target: z.string().optional(),
  /** 步骤输入（任意 JSON） */
  input: z.unknown(),
  /** 步骤输出（任意 JSON） */
  result: z.unknown(),
  /** 关联产物 ID 列表 */
  artifacts: z.array(z.string()),
  /** 安全门判定（可选） */
  safetyGate: z.enum(['allow', 'ask', 'deny']).optional(),
  /** 开始时间（ISO 8601） */
  startedAt: z.string(),
  /** 步骤耗时（毫秒），非负整数 */
  durationMs: z.number().int().nonnegative(),
});

export type RunStep = z.infer<typeof RunStepSchema>;

// ─── RunResult ───────────────────────────────────────────────

/**
 * Run 结果 Schema（§6.5 — 主输出 artifact）。
 *
 * 对应架构设计文档 §6.5 RunResult.json 规范：
 *   包含 run 状态、Profile 引用、设备信息、执行摘要、用例结果、
 *   性能指标、baseline 增量、产物引用、失败解释。
 */
export const RunResultSchema = z.object({
  /** Schema 版本号 */
  schemaVersion: z.string(),
  /** Run 唯一标识 */
  runId: z.string(),
  /** 执行状态 */
  status: RunStatusSchema,
  /** 关联的 ProjectProfile 引用路径 */
  projectProfileRef: z.string(),
  /** 执行设备信息 */
  device: z.object({
    udid: z.string(),
    name: z.string(),
    model: z.string(),
    osVersion: z.string(),
    /** 执行目标类型（ADR-011） */
    targetKind: TargetKindSchema,
    /** Simulator runtime identifier（physical 为 undefined） */
    runtimeIdentifier: z.string().optional(),
  }),
  /** 执行摘要 */
  execution: ExecutionSummarySchema,
  /** 测试用例结果列表 */
  cases: z.array(TestCaseResultSchema),
  /** 性能指标 */
  metrics: PerformanceMetricsSchema,
  /** 执行环境元数据（ADR-011：Simulator 报告强制携带） */
  environment: z.object({
    /** physical 或 simulator */
    targetKind: TargetKindSchema,
    /** 能否代表真机表现（Simulator 固定 false） */
    representativeOfPhysicalDevice: z.boolean(),
    /** baseline 比较域（simulator_only 或 physical_only） */
    comparisonScope: z.enum(['simulator_only', 'physical_only']),
    /** 宿主机指纹（Simulator 必填） */
    hostFingerprint: z.string().optional(),
    /** Xcode 版本（Simulator 必填） */
    xcodeVersion: z.string().optional(),
  }),
  /** Baseline 对比增量（可选，首次 run 无 baseline 时不填充） */
  baselineDelta: BaselineDeltaSchema.optional(),
  /** 产物 ID 引用列表 */
  artifactRefs: z.array(z.string()),
  /** 失败解释（可选，passed 时不填充） */
  explanation: FailureExplanationSchema.optional(),
});

export type RunResult = z.infer<typeof RunResultSchema>;

// ─── ArtifactIndex ───────────────────────────────────────────

/**
 * 产物索引 Schema（§6.6）。
 * 对应 artifact-index.json —— 列出所有 run 中采集的产物元信息。
 */
export const ArtifactIndexSchema = z.object({
  /** Schema 版本号 */
  schemaVersion: z.string(),
  /** 关联的 Run ID */
  runId: z.string(),
  /** 产物列表 */
  artifacts: z.array(
    z.object({
      /** 产物唯一标识 */
      id: z.string(),
      /** 产物类型 */
      type: z.enum([
        'screenshot',
        'video',
        'uitree',
        'log',
        'crashlog',
        'trace',
        'xcresult',
        'json',
        'text',
      ]),
      /** 相对路径 */
      path: z.string(),
      /** MIME 类型（可选） */
      mimeType: z.string().optional(),
      /** 文件大小（字节），非负整数 */
      sizeBytes: z.number().int().nonnegative().optional(),
      /** SHA-256 校验和（可选） */
      sha256: z.string().optional(),
      /** 关联步骤 ID（可选） */
      relatedStep: z.string().optional(),
      /** 产生此产物的 backend（可选） */
      backend: z.string().optional(),
      /** 脱敏状态 */
      redactionStatus: z.enum(['raw-local-only', 'redacted', 'safe']),
    }),
  ),
});

export type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;

// ─── Migration ───────────────────────────────────────────────

/**
 * Extract major version number from a schema version string.
 * Returns NaN for unparseable versions (treated as v1 for migration).
 */
function extractMajorVersion(version: string | undefined): number {
  if (!version) return 1;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? 1 : major;
}

/**
 * Migrate a v1 RunResult to v2.
 *
 * ADR-011 §8 Schema Version:
 *   Historical v1 data is migrated as targetKind=physical.
 *   New writers MUST NOT produce documents without targetKind.
 *
 * If the input is already v2+ (schemaVersion !== '1.0' and targetKind present),
 * it is returned as-is after parsing.
 *
 * For v1 data:
 *   - device.targetKind → 'physical' (if absent)
 *   - execution.targetKind → 'physical' (if absent)
 *   - environment.targetKind → 'physical' (if absent)
 *   - environment.representativeOfPhysicalDevice → true (if absent)
 *   - environment.comparisonScope → 'physical_only' (if absent)
 *   - schemaVersion → '2.0'
 */
export function migrateV1ToV2(raw: unknown): RunResult {
  const data = raw as Record<string, unknown>;

  // If v3+ or unknown future version, parse and pass-through unchanged
  // (migration only applies to 1.0 → 2.0)
  const version = data.schemaVersion as string | undefined;
  const majorVersion = extractMajorVersion(version);
  if (majorVersion >= 3) {
    return RunResultSchema.parse(raw);
  }

  // If already v2+, parse and return
  if (version === '2.0' || version?.startsWith('2.')) {
    return RunResultSchema.parse(raw);
  }

  // Deep clone to avoid mutating input
  const migrated = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

  migrated.schemaVersion = '2.0';

  // Inject targetKind into device block
  if (migrated.device && typeof migrated.device === 'object') {
    const device = migrated.device as Record<string, unknown>;
    if (!device.targetKind) {
      device.targetKind = 'physical';
    }
  }

  // Inject targetKind into execution block
  if (migrated.execution && typeof migrated.execution === 'object') {
    const exec = migrated.execution as Record<string, unknown>;
    if (!exec.targetKind) {
      exec.targetKind = 'physical';
    }
  }

  // Inject environment block if absent, or fill missing fields
  if (!migrated.environment || typeof migrated.environment !== 'object') {
    migrated.environment = {
      targetKind: 'physical',
      representativeOfPhysicalDevice: true,
      comparisonScope: 'physical_only',
    };
  } else {
    const env = migrated.environment as Record<string, unknown>;
    if (!env.targetKind) env.targetKind = 'physical';
    if (env.representativeOfPhysicalDevice === undefined) env.representativeOfPhysicalDevice = true;
    if (!env.comparisonScope) env.comparisonScope = 'physical_only';
  }

  return RunResultSchema.parse(migrated);
}

// ─── Parse Helpers ───────────────────────────────────────────

/**
 * 安全解析 RunResult。
 * 非法字段会抛出 ZodError。
 */
export function parseRunResult(raw: unknown): RunResult {
  return RunResultSchema.parse(raw);
}

/**
 * 安全解析 ArtifactIndex。
 * 非法字段会抛出 ZodError。
 */
export function parseArtifactIndex(raw: unknown): ArtifactIndex {
  return ArtifactIndexSchema.parse(raw);
}
