import { z } from 'zod';
import { TargetKindSchema } from './device-artifacts.js';

/**
 * Device identity contracts — DeviceInfo / DeviceSnapshot / DeviceTarget /
 * HealthCheckResult / BackendCapabilities.
 *
 * B01 (promotion migration, guide §11.4): moved verbatim out of
 * device-types.ts into this focused module. device-types.ts re-exports these
 * symbols so existing importers of './device-types.js' keep working.
 *
 * ADR-011: iOS Simulator 同级支持 — targetKind/runtimeIdentifier
 * ADR-005: DeviceBackend 可插拔边界 — BackendCapabilities
 */

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
  /** 执行目标类型（ADR-011） */
  targetKind: TargetKindSchema,
  /** Simulator runtime identifier (e.g. 'com.apple.CoreSimulator.SimRuntime.iOS-18-2') */
  runtimeIdentifier: z.string().optional(),
  /** Simulator device type identifier (e.g. 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro') */
  deviceTypeIdentifier: z.string().optional(),
  /** Simulator boot state */
  state: z.enum(['booted', 'shutdown', 'creating', 'booting', 'shutting_down']).optional(),
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
  /** 执行目标类型（ADR-011） */
  targetKind: TargetKindSchema,
  /** 电量百分比 [0, 100]（Simulator 为 N/A） */
  battery: z.number().min(0).max(100).optional(),
  /** 是否已信任此设备（Simulator 为 N/A） */
  trusted: z.boolean(),
  /** 开发者模式是否开启（Simulator 为 N/A） */
  developerMode: z.boolean().optional(),
  /** Simulator runtime identifier */
  runtimeIdentifier: z.string().optional(),
  /** Simulator device type identifier */
  deviceTypeIdentifier: z.string().optional(),
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
  /** Backend 支持的目标类型（ADR-011） */
  supportedTargetKinds: z.array(TargetKindSchema),
  /** Backend 支持的能力列表 */
  features: z.array(z.string()),
  /** 是否支持 UI 树（accessibility tree） */
  supportsUiTree: z.boolean().default(true),
  /** 是否支持截图 */
  supportsScreenshot: z.boolean().default(true),
  /** 是否支持录屏 */
  supportsVideo: z.boolean().default(false),
  /** 是否支持崩溃日志 */
  supportsCrashLogs: z.boolean().default(false),
  /** 是否支持位置模拟 */
  supportsLocation: z.boolean().default(false),
  /** 是否支持推送模拟 */
  supportsPush: z.boolean().default(false),
});

export type BackendCapabilities = z.infer<typeof BackendCapabilitiesSchema>;
