import { z } from 'zod';

/**
 * Device runtime contracts — ActionResult / UiTreeSnapshot / CrashSummary /
 * RecordingHandle.
 *
 * B01 (promotion migration, guide §11.4): moved verbatim out of
 * device-types.ts into this focused module. device-types.ts re-exports these
 * symbols so existing importers of './device-types.js' keep working.
 */

// ─── ActionResult ───────────────────────────────────────────

/**
 * Backend 通用操作结果 Schema。
 */
export const ActionResultSchema = z.object({
  /** 操作是否成功 */
  success: z.boolean(),
  /** 成功描述信息（可选） */
  message: z.string().optional(),
  /** 错误信息（可选，failure 时填充） */
  error: z.string().optional(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

// ─── UiTreeSnapshot ─────────────────────────────────────────

/**
 * UI 树快照 Schema。
 * 对应探索执行中通过 DeviceBackend 采集的 UI 层级快照。
 */
export const UiTreeSnapshotSchema = z.object({
  /** 原始 UI 树内容 */
  raw: z.string(),
  /** 序列化格式 */
  format: z.enum(['xml', 'json']),
  /** 采集时间戳（ISO 8601） */
  capturedAt: z.string(),
});

export type UiTreeSnapshot = z.infer<typeof UiTreeSnapshotSchema>;

// ─── CrashSummary ───────────────────────────────────────────

/**
 * Crash 摘要 Schema。
 * 对应设备 crashlog 列表中的单条 crash。
 */
export const CrashSummarySchema = z.object({
  /** Crash 进程名称 / 异常类型 */
  name: z.string(),
  /** Crash 发生时间（ISO 8601） */
  date: z.string(),
  /** 关联的 Bundle ID（可选） */
  bundleId: z.string().optional(),
});

export type CrashSummary = z.infer<typeof CrashSummarySchema>;

// ─── RecordingHandle ────────────────────────────────────────

/**
 * 录制/采集句柄 Schema。
 * 对应开始录制/采集后返回的句柄，用于后续停止/导出。
 */
export const RecordingHandleSchema = z.object({
  /** 句柄唯一标识 */
  handleId: z.string(),
  /** 开始时间戳（ISO 8601） */
  startedAt: z.string(),
});

export type RecordingHandle = z.infer<typeof RecordingHandleSchema>;
