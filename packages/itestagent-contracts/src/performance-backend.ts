import { z } from 'zod';
import { TargetKindSchema } from './device-types.js';
import type { ArtifactRef } from './device-types.js';

/**
 * PerformanceBackend 类型 Schema（Zod）+ 接口定义
 *
 * AC 原文（架构设计文档 §5.2 PerformanceBackend）：
 *   PerformanceBackend 负责性能采集（trace 录制/导出/摘要）、崩溃符号化、
 *   基线对比。5 个方法：recordTrace / exportTrace / summarizeTrace / symbolicate /
 *   compareBaseline。
 *
 * 技术选型 §11 性能采集：
 *   MVP 第一候选：xctrace（xctrace + hitches parser + raw xcrun fallback）
 *   次选：InstrumentsMCP（录制/report 参考，非默认可信）
 *
 * AGENTS.md §5 数据契约：产物必须带 schemaVersion，面向 schema 编码。
 *
 * L3 模块（依赖 L1 device-types ArtifactRef，不引入 L4+ 依赖）。
 */

// ─── TraceRecordInput ────────────────────────────────────────

/**
 * 开始性能录制输入。
 * 对应 recordTrace 方法参数。
 */
export const TraceRecordInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 被测应用 Bundle ID */
  bundleId: z.string(),
  /** 录制模板（可选，默认 'all'） */
  template: z.enum(['cpu', 'hangs', 'memory', 'launch', 'all']).optional(),
  /** 录制时长（秒），正整数 */
  durationSeconds: z.number().int().positive().optional(),
});

export type TraceRecordInput = z.infer<typeof TraceRecordInputSchema>;

// ─── TraceExportInput ────────────────────────────────────────

/**
 * 导出 trace 数据输入。
 * 对应 exportTrace 方法参数。
 */
export const TraceExportInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 原始 trace 文件路径 */
  tracePath: z.string(),
  /** 导出格式（可选，默认 'xml'） */
  format: z.enum(['xml', 'json']).optional(),
});

export type TraceExportInput = z.infer<typeof TraceExportInputSchema>;

// ─── TraceExportStatus ───────────────────────────────────────

/**
 * trace 导出状态。
 * 对应 exportTrace 方法返回值。
 */
export const TraceExportStatusSchema = z.object({
  /** 导出状态 */
  status: z.enum(['exporting', 'completed', 'failed']),
  /** 已导出的文件列表（completed 时填充） */
  exportedFiles: z.array(z.string()).optional(),
  /** 错误信息（failed 时填充） */
  error: z.string().optional(),
});

export type TraceExportStatus = z.infer<typeof TraceExportStatusSchema>;

// ─── TraceSummaryInput ───────────────────────────────────────

/**
 * 分析 trace 摘要输入。
 * 对应 summarizeTrace 方法参数。
 */
export const TraceSummaryInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 已导出的 trace 数据路径 */
  exportedPath: z.string(),
});

export type TraceSummaryInput = z.infer<typeof TraceSummaryInputSchema>;

// ─── TraceSummary ────────────────────────────────────────────

/**
 * trace 摘要结果。
 * 对应 summarizeTrace 方法返回值。
 *
 * 红线 R5：不静默降级/臆造指标。不确定项使用 approximate 字段显式标注。
 */
export const TraceSummarySchema = z.object({
  /** 总采样数 */
  totalSamples: z.number().int().nonnegative().optional(),
  /** 卡顿次数 */
  hangCount: z.number().int().nonnegative().optional(),
  /** hitches 摘要（结构由解析器决定，实验性） */
  hitchesSummary: z.unknown().optional(),
  /** 启动耗时（毫秒） */
  launchDurationMs: z.number().int().nonnegative().optional(),
  /** 内存峰值（MB） */
  memoryPeakMB: z.number().nonnegative().optional(),
  /** 是否检测到 crash */
  crashDetected: z.boolean().optional(),
  /** 是否有指标为近似值/估算值（R5 强制标注） */
  approximate: z.boolean().optional(),
});

export type TraceSummary = z.infer<typeof TraceSummarySchema>;

// ─── SymbolicateInput ────────────────────────────────────────

/**
 * 崩溃符号化输入。
 * 对应 symbolicate 方法参数。
 */
export const SymbolicateInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** crashlog 文件路径 */
  crashlogPath: z.string(),
  /** dSYM 文件路径（可选，自动搜索时可不传） */
  dsymPath: z.string().optional(),
});

export type SymbolicateInput = z.infer<typeof SymbolicateInputSchema>;

// ─── BaselineCompareInput ────────────────────────────────────

/**
 * 基线对比输入。
 * 对应 compareBaseline 方法参数。
 */
export const BaselineCompareInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 当前 trace 摘要 */
  current: TraceSummarySchema,
  /** 基线唯一标识 */
  baselineId: z.string(),
  /** 执行目标类型（ADR-011 §6：baseline 分域隔离） */
  targetKind: TargetKindSchema,
});

export type BaselineCompareInput = z.infer<typeof BaselineCompareInputSchema>;

// ─── BaselineDelta ───────────────────────────────────────────

/**
 * 基线对比增量结果。
 * 对应 compareBaseline 方法返回值。
 *
 * AGENTS.md §6：首次成功 run 建立 baseline；失败/crash 不建；
 * 后续对比趋势；接受新 baseline 需确认。
 */
export const BaselineDeltaSchema = z.object({
  /** 基线唯一标识 */
  baselineId: z.string(),
  /** 对比的 run ID */
  runId: z.string(),
  /** 对比时间（ISO 8601） */
  comparedAt: z.string(),
  /** 执行目标类型（ADR-011 §6：baseline 分域隔离） */
  targetKind: TargetKindSchema,
  /** 各指标增量 */
  deltas: z.object({
    /** 启动耗时增量（毫秒），正值为回归 */
    launchDurationMs: z.number().optional(),
    /** 内存峰值增量（MB），正值为回归 */
    memoryPeakMB: z.number().optional(),
    /** 卡顿次数变化 */
    hangCount: z.number().optional(),
    /** hitches 变化趋势 */
    hitches: z.enum(['improved', 'regressed', 'unchanged', 'inconclusive']).optional(),
  }),
  /** 综合判定 */
  summary: z.enum(['improved', 'regressed', 'unchanged', 'inconclusive']),
});

export type BaselineDelta = z.infer<typeof BaselineDeltaSchema>;

// ─── PerformanceBackend Interface ────────────────────────────

/**
 * 性能采集 Backend 接口。
 *
 * 架构设计文档 §5.2：
 *   PerformanceBackend 封装 xctrace / InstrumentsMCP 等性能采集工具，
 *   提供录制、导出、摘要、符号化、基线对比 5 个能力。
 *
 * 技术选型 §11：
 *   MVP 第一候选：xctrace（xctrace + hitches parser + raw xcrun fallback）。
 *   未来可选：InstrumentsMCP（录制/report 参考）。
 */
export interface PerformanceBackend {
  /** 开始性能录制，返回 trace 产物引用 */
  recordTrace(input: TraceRecordInput): Promise<ArtifactRef>;

  /** 导出 trace 数据，返回导出状态 */
  exportTrace(input: TraceExportInput): Promise<TraceExportStatus>;

  /** 分析 trace 导出数据，返回性能摘要 */
  summarizeTrace(input: TraceSummaryInput): Promise<TraceSummary>;

  /** 符号化崩溃日志，返回符号化后的产物引用 */
  symbolicate(input: SymbolicateInput): Promise<ArtifactRef>;

  /** 对比当前摘要与历史基线，返回增量结果 */
  compareBaseline(input: BaselineCompareInput): Promise<BaselineDelta>;
}
