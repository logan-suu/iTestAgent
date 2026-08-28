import { z } from 'zod';

/**
 * Device/Artifact/Action 类型 Schema（Zod）
 *
 * ADR-011: iOS Simulator 同级支持 — TargetKind, BackendCapabilities.supportedTargetKinds
 * ADR-005: DeviceBackend 可插拔边界
 * 架构设计文档 §3 + 数据流全链路 S1-S9
 *
 * 所有产物、设备信息、Backend 交互参数均需 schema 约束，面向 schema 编码。
 * AGENTS.md §5 数据契约：产物必须带 schemaVersion。
 *
 * 本文件定义 L1 层类型——依赖 L0（agent-error.ts），不引入 L2+ 依赖。
 *
 * B01 (promotion migration, guide §11.4): the device-core schemas were split
 * into focused modules — device-artifacts.ts / device-identity.ts /
 * device-runtime.ts / device-action-inputs.ts. This file re-exports them so
 * existing importers of './device-types.js' keep working, and keeps
 * AppInfoSchema (not part of any of the four slices) defined here.
 */

export {
  TargetKindSchema,
  ArtifactTypeSchema,
  RedactionStatusSchema,
  ArtifactRefSchema,
  parseArtifactRef,
} from './device-artifacts.js';

export type {
  TargetKind,
  ArtifactType,
  RedactionStatus,
  ArtifactRef,
} from './device-artifacts.js';

export {
  DeviceInfoSchema,
  DeviceSnapshotSchema,
  DeviceTargetSchema,
  HealthCheckResultSchema,
  BackendCapabilitiesSchema,
} from './device-identity.js';

export type {
  DeviceInfo,
  DeviceSnapshot,
  DeviceTarget,
  HealthCheckResult,
  BackendCapabilities,
} from './device-identity.js';

export {
  ActionResultSchema,
  UiTreeSnapshotSchema,
  CrashSummarySchema,
  RecordingHandleSchema,
} from './device-runtime.js';

export type {
  ActionResult,
  UiTreeSnapshot,
  CrashSummary,
  RecordingHandle,
} from './device-runtime.js';

export {
  LaunchAppInputSchema,
  TerminateAppInputSchema,
  TapInputSchema,
  SwipeInputSchema,
  TypeTextInputSchema,
  PressButtonInputSchema,
  OpenUrlInputSchema,
  ScreenshotInputSchema,
  RecordingInputSchema,
  LogCollectInputSchema,
} from './device-action-inputs.js';

export type {
  LaunchAppInput,
  TerminateAppInput,
  TapInput,
  SwipeInput,
  TypeTextInput,
  PressButtonInput,
  OpenUrlInput,
  ScreenshotInput,
  RecordingInput,
  LogCollectInput,
} from './device-action-inputs.js';

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
