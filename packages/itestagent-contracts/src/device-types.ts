import { z } from 'zod';

/**
 * Device/Artifact/Action 类型 Schema（Zod）
 *
 * AC 原文（架构设计文档 §3 + 数据流全链路 S1-S9）：
 *   所有产物、设备信息、Backend 交互参数均需 schema 约束，面向 schema 编码。
 *
 * AGENTS.md §5 数据契约：产物必须带 schemaVersion，面向 schema 编码。
 *
 * 本文件定义 L1 层类型——依赖 L0（agent-error.ts），不引入 L2+ 依赖。
 */

// ─── ArtifactType ───────────────────────────────────────────

/**
 * 产物类型枚举。
 * 对应架构设计文档 §5 Backend 接口设计：artifact-index.json 的 type 字段。
 */
export const ArtifactTypeSchema = z.enum([
  'screenshot',
  'video',
  'uitree',
  'log',
  'crashlog',
  'trace',
  'xcresult',
  'json',
  'text',
]);

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

// ─── RedactionStatus ────────────────────────────────────────

/**
 * 脱敏状态。
 * raw-local-only: 含敏感信息，仅本地存储，不入报告
 * redacted:      已脱敏处理
 * safe:          不含敏感信息
 */
export const RedactionStatusSchema = z.enum(['raw-local-only', 'redacted', 'safe']);

export type RedactionStatus = z.infer<typeof RedactionStatusSchema>;

// ─── ArtifactRef ────────────────────────────────────────────

/**
 * 产物引用 Schema。
 * 对应 artifact-index.json 中单个 artifact 条目（数据流全链路 S8）。
 */
export const ArtifactRefSchema = z.object({
  /** 产物唯一标识 */
  id: z.string(),
  /** 产物类型 */
  type: ArtifactTypeSchema,
  /** 相对 run 根目录的文件路径 */
  path: z.string(),
  /** MIME 类型（可选，如 image/png） */
  mimeType: z.string().optional(),
  /** 文件大小（字节），非负整数 */
  sizeBytes: z.number().int().nonnegative().optional(),
  /** SHA-256 校验和（可选） */
  sha256: z.string().optional(),
  /** 关联的 run step id（可选） */
  relatedStep: z.string().optional(),
  /** 产生此产物的 backend（可选） */
  backend: z.string().optional(),
  /** 脱敏状态 */
  redactionStatus: RedactionStatusSchema,
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

// ─── DeviceInfo ─────────────────────────────────────────────

/**
 * 设备基本信息 Schema。
 * 对应 itestagent devices 命令输出中的单条设备记录。
 */
export const DeviceInfoSchema = z.object({
  /** 设备 UDID */
  udid: z.string(),
  /** 设备名称 */
  name: z.string().optional(),
  /** 设备型号 */
  model: z.string().optional(),
  /** 操作系统版本 */
  osVersion: z.string().optional(),
  /** 平台 */
  platform: z.enum(['ios', 'android']),
});

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

// ─── DeviceSnapshot ─────────────────────────────────────────

/**
 * 设备快照 Schema（含诊断信息）。
 * 对应 itestagent doctor 命令的诊断输出。
 */
export const DeviceSnapshotSchema = z.object({
  /** 设备 UDID */
  udid: z.string(),
  /** 设备名称 */
  name: z.string(),
  /** 设备型号 */
  model: z.string(),
  /** 操作系统版本 */
  osVersion: z.string(),
  /** 电量百分比 [0, 100] */
  battery: z.number().min(0).max(100).optional(),
  /** 是否已信任此设备 */
  trusted: z.boolean(),
  /** 开发者模式是否开启（可选，Android 特有） */
  developerMode: z.boolean().optional(),
});

export type DeviceSnapshot = z.infer<typeof DeviceSnapshotSchema>;

// ─── DeviceTarget ───────────────────────────────────────────

/**
 * 测试目标设备标识。
 */
export const DeviceTargetSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
});

export type DeviceTarget = z.infer<typeof DeviceTargetSchema>;

// ─── HealthCheckResult ──────────────────────────────────────

/**
 * 健康检查结果 Schema。
 * 对应 itestagent doctor 各子检查项的返回。
 */
export const HealthCheckResultSchema = z.object({
  /** 是否健康 */
  healthy: z.boolean(),
  /** 诊断详情（可选） */
  details: z.string().optional(),
});

export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

// ─── BackendCapabilities ────────────────────────────────────

/**
 * Backend 能力清单 Schema。
 * 对应每个 DeviceBackend 实现的健康检查返回。
 */
export const BackendCapabilitiesSchema = z.object({
  /** Backend 支持的能力列表 */
  features: z.array(z.string()),
});

export type BackendCapabilities = z.infer<typeof BackendCapabilitiesSchema>;

// ─── AppInfo ────────────────────────────────────────────────

/**
 * 应用信息 Schema。
 * 对应被测应用的基本标识信息。
 */
export const AppInfoSchema = z.object({
  /** 应用 Bundle ID */
  bundleId: z.string(),
  /** 应用显示名称 */
  name: z.string(),
  /** 应用版本号（可选） */
  version: z.string().optional(),
  /** 构建号（可选） */
  buildNumber: z.string().optional(),
});

export type AppInfo = z.infer<typeof AppInfoSchema>;

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

// ─── Backend Action Input Schemas ───────────────────────────

/**
 * 启动应用输入 Schema。
 */
export const LaunchAppInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 应用 Bundle ID */
  bundleId: z.string(),
});

export type LaunchAppInput = z.infer<typeof LaunchAppInputSchema>;

/**
 * 终止应用输入 Schema。
 */
export const TerminateAppInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 应用 Bundle ID */
  bundleId: z.string(),
});

export type TerminateAppInput = z.infer<typeof TerminateAppInputSchema>;

/**
 * 点击输入 Schema。
 * x, y 均为屏幕归一化坐标 [0, 1]。
 */
export const TapInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 归一化 x 坐标 [0, 1] */
  x: z.number().min(0).max(1),
  /** 归一化 y 坐标 [0, 1] */
  y: z.number().min(0).max(1),
});

export type TapInput = z.infer<typeof TapInputSchema>;

/**
 * 滑动输入 Schema。
 * 起止坐标均为屏幕归一化坐标 [0, 1]。
 */
export const SwipeInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 起始 x 坐标 [0, 1] */
  fromX: z.number().min(0).max(1),
  /** 起始 y 坐标 [0, 1] */
  fromY: z.number().min(0).max(1),
  /** 结束 x 坐标 [0, 1] */
  toX: z.number().min(0).max(1),
  /** 结束 y 坐标 [0, 1] */
  toY: z.number().min(0).max(1),
  /** 滑动持续时间（毫秒），正整数 */
  durationMs: z.number().int().positive().optional(),
});

export type SwipeInput = z.infer<typeof SwipeInputSchema>;

/**
 * 文本输入 Schema。
 */
export const TypeTextInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 待输入的文本 */
  text: z.string(),
});

export type TypeTextInput = z.infer<typeof TypeTextInputSchema>;

/**
 * 物理按键输入 Schema。
 */
export const PressButtonInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 按键名称 */
  button: z.enum(['home', 'back', 'volumeUp', 'volumeDown']),
});

export type PressButtonInput = z.infer<typeof PressButtonInputSchema>;

/**
 * 打开 URL 输入 Schema。
 */
export const OpenUrlInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 要打开的 URL */
  url: z.string(),
});

export type OpenUrlInput = z.infer<typeof OpenUrlInputSchema>;

/**
 * 截图输入 Schema。
 */
export const ScreenshotInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
});

export type ScreenshotInput = z.infer<typeof ScreenshotInputSchema>;

/**
 * 录制/采集输入 Schema。
 */
export const RecordingInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 录制类型 */
  type: z.enum(['video', 'screenshot']),
});

export type RecordingInput = z.infer<typeof RecordingInputSchema>;

/**
 * 日志采集输入 Schema。
 */
export const LogCollectInputSchema = z.object({
  /** 目标设备 ID */
  deviceId: z.string(),
  /** 日志类型 */
  type: z.enum(['syslog', 'crashlog']),
  /** 采集时长（秒），正整数 */
  durationSeconds: z.number().int().positive().optional(),
});

export type LogCollectInput = z.infer<typeof LogCollectInputSchema>;

// ─── 工具函数 ────────────────────────────────────────────────

/**
 * 安全解析 ArtifactRef。
 * 非法字段会抛出 ZodError。
 */
export function parseArtifactRef(raw: unknown): ArtifactRef {
  return ArtifactRefSchema.parse(raw);
}
