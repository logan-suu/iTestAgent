import { z } from 'zod';
import { RunIdSchema } from './run-id.js';

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

export const ARTIFACT_INDEX_SCHEMA_VERSION = '2.0';

export const EvidenceCollectionStatusSchema = z.enum([
  'collected',
  'not_requested',
  'not_applicable',
  'unsupported',
  'failed',
]);

export const EvidenceCollectionOutcomeSchema = z
  .object({
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
    status: EvidenceCollectionStatusSchema,
    reasonCode: z.string().min(1),
    message: z.string().optional(),
    artifactId: z.string().min(1).optional(),
    relatedStep: z.string().min(1).optional(),
    relatedCase: z.string().min(1).optional(),
  })
  .superRefine((outcome, ctx) => {
    if (outcome.status === 'collected' && !outcome.artifactId) {
      ctx.addIssue({
        code: 'custom',
        path: ['artifactId'],
        message: 'collected outcome requires artifactId',
      });
    }
    if (outcome.status !== 'collected' && outcome.artifactId) {
      ctx.addIssue({
        code: 'custom',
        path: ['artifactId'],
        message: 'non-collected outcome must not reference an artifact',
      });
    }
  });

/**
 * 产物索引 Schema（§6.6）。
 */
export const ArtifactIndexSchema = z.object({
  /** Schema version. */
  schemaVersion: z.literal(ARTIFACT_INDEX_SCHEMA_VERSION),
  /** Owning run ID. */
  runId: RunIdSchema,
  /** Collected artifacts. */
  artifacts: z.array(
    z.object({
      /** Unique artifact ID. */
      id: z.string(),
      /** Artifact type. */
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
      /** Run-relative path. */
      path: z.string(),
      /** Optional MIME type. */
      mimeType: z.string().optional(),
      /** Optional non-negative byte size. */
      sizeBytes: z.number().int().nonnegative().optional(),
      /** Optional SHA-256 digest. */
      sha256: z.string().optional(),
      /** Optional related step ID. */
      relatedStep: z.string().optional(),
      /** Related test case ID (optional). */
      relatedCase: z.string().optional(),
      /** Optional producing backend. */
      backend: z.string().optional(),
      /** Redaction status. */
      redactionStatus: z.enum(['raw-local-only', 'redacted', 'safe']),
    }),
  ),
  /** Evidence slots evaluated for this run, including unsuccessful collection. */
  collectionOutcomes: z.array(EvidenceCollectionOutcomeSchema),
});

export type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;
export type EvidenceCollectionStatus = z.infer<typeof EvidenceCollectionStatusSchema>;
export type EvidenceCollectionOutcome = z.infer<typeof EvidenceCollectionOutcomeSchema>;

// ─── Parse Helpers ───────────────────────────────────────────

/**
 * 安全解析 ArtifactIndex。
 * 非法字段会抛出 ZodError。
 */
export function parseArtifactIndex(raw: unknown): ArtifactIndex {
  return ArtifactIndexSchema.parse(raw);
}
