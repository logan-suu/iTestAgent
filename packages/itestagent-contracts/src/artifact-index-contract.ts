import { z } from 'zod';

/**
 * ArtifactIndex contract — the artifact-index.json manifest schema.
 *
 * B03 (promotion migration, guide §11.4 "result+artifact-index→B03"): moved
 * verbatim out of data-contracts.ts into this focused module.
 * data-contracts.ts re-exports these symbols so existing importers of
 * './data-contracts.js' keep working (same pattern as the B01 device-core
 * split).
 *
 * 架构设计文档 §6.6：对应 artifact-index.json —— 列出所有 run 中采集的产物
 * 元信息。AGENTS.md §5 数据契约：产物必须带 schemaVersion。
 */

// ─── ArtifactIndex ───────────────────────────────────────────

/**
 * 产物索引 Schema（§6.6）。
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
        'syslog',
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
      /** Related test case ID (optional). */
      relatedCase: z.string().optional(),
      /** 产生此产物的 backend（可选） */
      backend: z.string().optional(),
      /** 脱敏状态 */
      redactionStatus: z.enum(['raw-local-only', 'redacted', 'safe']),
    }),
  ),
});

export type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;

// ─── Parse Helpers ───────────────────────────────────────────

/**
 * 安全解析 ArtifactIndex。
 * 非法字段会抛出 ZodError。
 */
export function parseArtifactIndex(raw: unknown): ArtifactIndex {
  return ArtifactIndexSchema.parse(raw);
}
