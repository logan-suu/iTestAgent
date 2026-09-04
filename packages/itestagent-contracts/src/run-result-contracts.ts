import { z } from 'zod';
import { TargetKindSchema } from './device-types.js';
import { BaselineDeltaSchema } from './performance-backend.js';
import { RunIdSchema } from './run-id.js';

/**
 * RunResult contracts — RunStatus / PerformanceMetrics / ExecutionSummary /
 * TestCaseResult / FailureExplanation / RunStep / RunResult + migration and
 * parse helpers.
 *
 * B03 (promotion migration, guide §11.4 "result+artifact-index→B03"): moved
 * verbatim out of data-contracts.ts into this focused module.
 * data-contracts.ts re-exports these symbols so existing importers of
 * './data-contracts.js' keep working (same pattern as the B01 device-core
 * split).
 *
 * 架构设计文档 §6.3-§6.5 + 数据流全链路 S6-S8：
 *   所有产物均带 schemaVersion，面向 schema 编码。
 *
 * AGENTS.md §5 数据契约：
 *   产物必须带 schemaVersion；report 固定三件套 summary.md + result.json +
 *   artifact-index.json。
 */

// ─── Constants ───────────────────────────────────────────────

/** Canonical schema version emitted for result.json. */
export const RUN_RESULT_SCHEMA_VERSION = '3.0';

/** Backward-compatible alias used by report callers. */
export const DEFAULT_SCHEMA_VERSION = RUN_RESULT_SCHEMA_VERSION;

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
  'cancelled',
  'infra_failed',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Case status intentionally excludes the run-only infrastructure outcome. */
export const CaseStatusSchema = z.enum([
  'passed',
  'failed',
  'explored',
  'inconclusive',
  'needs_assertion',
  'flaky',
  'blocked',
  'cancelled',
]);

export type CaseStatus = z.infer<typeof CaseStatusSchema>;

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
  status: CaseStatusSchema,
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
 * Failure explanation schema.
 * Maps to Architecture Design §6.5 RunResult.explanation + itestagent explain CLI.
 */
export const FailureExplanationSchema = z.object({
  /** Failure classification */
  explanationType: z.enum([
    'product_regression',
    'script_issue',
    'device_issue',
    'env_issue',
    'flaky',
    'perf_regression',
    'inconclusive',
  ]),
  /** Human-readable failure summary */
  summary: z.string(),
  /** Supporting evidence list (artifact IDs or log excerpts) */
  evidence: z.array(z.string()),
  /** Suggested remediation actions (optional). Maps to S8 contract suggestedActions[]. */
  suggestedActions: z.array(z.string()).optional(),
  /** Confidence level (optional) */
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
  /** Strictly increasing run-local execution order, starting at 1. */
  sequence: z.number().int().positive(),
  /** 执行此步骤的 backend 名称 */
  backend: z.string(),
  /** Target kind used for the actual execution. */
  targetKind: TargetKindSchema,
  /** Owning case ID; run-level setup and teardown steps may omit it. */
  caseId: z.string().min(1).optional(),
  /** 动作类型 */
  action: z.string(),
  /** 动作目标（可选） */
  target: z.string().optional(),
  /** 步骤输入（任意 JSON） */
  input: z.unknown(),
  /** 步骤输出（任意 JSON） */
  result: z.unknown(),
  /** Actual execution status; blocked and failed steps are never successful. */
  status: z.enum(['completed', 'failed', 'blocked']),
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
export const RunResultSchema = z
  .object({
    /** Schema version. */
    schemaVersion: z.literal(RUN_RESULT_SCHEMA_VERSION),
    /** Unique run ID. */
    runId: RunIdSchema,
    /** Immediate source run for a rerun child (ADR-035). */
    parentRunId: RunIdSchema.optional(),
    /** Final execution status. */
    status: RunStatusSchema,
    /** Optional associated ProjectProfile reference. */
    projectProfileRef: z.string().min(1).optional(),
    /** Execution device details. */
    device: z.object({
      udid: z.string(),
      name: z.string(),
      model: z.string(),
      osVersion: z.string(),
      /** Execution target kind (ADR-011). */
      targetKind: TargetKindSchema,
      /** Simulator runtime identifier; absent for physical devices. */
      runtimeIdentifier: z.string().optional(),
    }),
    /** Execution summary. */
    execution: ExecutionSummarySchema,
    /** Test case results. */
    cases: z.array(TestCaseResultSchema),
    /** Performance metrics. */
    metrics: PerformanceMetricsSchema,
    /** Execution environment metadata required by ADR-011. */
    environment: z.object({
      /** Physical device or Simulator. */
      targetKind: TargetKindSchema,
      /** Whether results represent physical-device behavior. */
      representativeOfPhysicalDevice: z.boolean(),
      /** Baseline comparison domain. */
      comparisonScope: z.enum(['simulator_only', 'physical_only']),
      /** Host fingerprint required for Simulator reports. */
      hostFingerprint: z.string().optional(),
      /** Xcode version required for Simulator reports. */
      xcodeVersion: z.string().optional(),
    }),
    /** Optional baseline delta; absent when no baseline exists. */
    baselineDelta: BaselineDeltaSchema.optional(),
    /** Artifact ID references. */
    artifactRefs: z.array(z.string()),
    /** Optional failure explanation; omitted for passed runs. */
    explanation: FailureExplanationSchema.optional(),
  })
  .superRefine((result, ctx) => {
    if (result.parentRunId === result.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentRunId'],
        message: 'parentRunId must differ from runId',
      });
    }
    if (!result.execution.mode) {
      ctx.addIssue({
        code: 'custom',
        path: ['execution', 'mode'],
        message: 'RunResult v3 requires execution.mode',
      });
    }
  });

export type RunResult = z.infer<typeof RunResultSchema>;

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
export interface MigratedRunResultV2 extends Record<string, unknown> {
  schemaVersion: string;
  device: Record<string, unknown>;
  execution: Record<string, unknown>;
  environment: Record<string, unknown>;
}

export function migrateV1ToV2(raw: unknown): MigratedRunResultV2 {
  const data = raw as Record<string, unknown>;

  // If v3+ or unknown future version, parse and pass-through unchanged
  // (migration only applies to 1.0 → 2.0)
  const version = data.schemaVersion as string | undefined;
  const majorVersion = extractMajorVersion(version);
  if (majorVersion >= 3) {
    return structuredClone(data) as MigratedRunResultV2;
  }

  // If already v2+, parse and return
  if (version === '2.0' || version?.startsWith('2.')) {
    return structuredClone(data) as MigratedRunResultV2;
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

  return migrated as MigratedRunResultV2;
}

// ─── Parse Helpers ───────────────────────────────────────────

/**
 * 安全解析 RunResult。
 * 非法字段会抛出 ZodError。
 */
export function parseRunResult(raw: unknown): RunResult {
  return RunResultSchema.parse(raw);
}
