import { z } from 'zod';

/**
 * Device artifact contracts — TargetKind / ArtifactType / RedactionStatus /
 * ArtifactRef + parseArtifactRef.
 *
 * B01 (promotion migration, guide §11.4): moved verbatim out of
 * device-types.ts into this focused module. device-types.ts re-exports these
 * symbols so existing importers of './device-types.js' keep working.
 *
 * ADR-011: iOS Simulator 同级支持 — TargetKind
 */

// ─── TargetKind ──────────────────────────────────────────────

/**
 * 执行目标类型（ADR-011）。
 * physical: iPhone 真机    simulator: iOS Simulator
 */
export const TargetKindSchema = z.enum(['physical', 'simulator']);

export type TargetKind = z.infer<typeof TargetKindSchema>;

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
  'syslog',
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
  /** Related test case ID; required for evidence used in case evaluation. */
  relatedCase: z.string().optional(),
  /** 产生此产物的 backend（可选） */
  backend: z.string().optional(),
  /** 脱敏状态 */
  redactionStatus: RedactionStatusSchema,
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

// ─── 工具函数 ────────────────────────────────────────────────

/**
 * 安全解析 ArtifactRef。
 * 非法字段会抛出 ZodError。
 */
export function parseArtifactRef(raw: unknown): ArtifactRef {
  return ArtifactRefSchema.parse(raw);
}
