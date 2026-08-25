import { z } from 'zod';

/**
 * Device backend action input contracts — LaunchApp / TerminateApp / Tap /
 * Swipe / TypeText / PressButton / OpenUrl / Screenshot / Recording /
 * LogCollect.
 *
 * B01 (promotion migration, guide §11.4): moved verbatim out of
 * device-types.ts into this focused module. device-types.ts re-exports these
 * symbols so existing importers of './device-types.js' keep working.
 */

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
