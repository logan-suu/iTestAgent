import { z } from 'zod';
import { TargetKindSchema } from './device-types.js';

/**
 * Baseline Record + BaselineStore interface — S8 baseline persistence layer.
 *
 * Data Flow Specification §11 (S8):
 *   baseline key = <project>|<targetKind>|<deviceModel>|<iOS>|<scenario>
 *   Simulator baseline must include: hostFingerprint, XcodeVersion, runtimeIdentifier
 *
 * AGENTS.md §6 Domain Rules:
 *   First successful run establishes baseline; failures/crashes do not.
 *   Subsequent runs produce trend comparison.
 *   Accepting a new baseline requires user confirmation (R7).
 *
 * ADR-011 §6: physical and simulator baselines are strictly domain-isolated.
 *   Store/Schema layer MUST reject cross-domain comparisons.
 */

// ─── Baseline Record Schema ──────────────────────────────────

/**
 * Full baseline record stored at ~/.itestagent/baselines/<targetKind>/<key>.json
 *
 * S8 data contract: key is the primary identifier combining
 * project + targetKind + deviceModel + iOS version + scenario.
 */
export const BaselineRecordSchema = z
  .object({
    /** Schema version for forward compatibility (S8 requirement) */
    schemaVersion: z.literal(2),
    /** Composite key: <project>|<targetKind>|<deviceModel>|<iOS>|<scenario> */
    key: z.string(),
    /** Target domain — MUST match the storage subdirectory (ADR-011 cross-domain guard) */
    targetKind: TargetKindSchema,
    // ─── Performance metrics (all optional — only populated when measured) ───
    /** Launch duration in milliseconds */
    launchDurationMs: z.number().int().nonnegative().optional(),
    /** Memory peak in MB (approximate per R5) */
    memoryPeakMB: z.number().nonnegative().optional(),
    /** Number of detected hangs */
    hangCount: z.number().int().nonnegative().optional(),
    /** Hitches summary (structured by parser, experimental per S8) */
    hitchesSummary: z.unknown().optional(),
    /** FPS approximate value (R5: not guaranteed precise real-time FPS) */
    fpsApproximate: z.number().nonnegative().optional(),
    /** Whether any metrics in this baseline are approximate (R5) */
    approximate: z.boolean().default(true),
    // ─── Lifecycle metadata ───
    /** Run ID that generated this baseline */
    updatedFromRun: z.string(),
    /** ISO 8601 timestamp of creation */
    createdAt: z.string(),
    /** ISO 8601 timestamp of last update */
    updatedAt: z.string(),
    /** Ordered list of run IDs that contributed to this baseline (most recent first) */
    reachableRuns: z.array(z.string()),
    // ─── Simulator-only metadata (ADR-011 §6, populated only when targetKind=simulator) ───
    /** Simulator comparison scope marker */
    comparisonScope: z.literal('simulator_only').optional(),
    /** Simulator performance data is never representative of physical device behavior */
    representativeOfPhysicalDevice: z.literal(false).optional(),
    /** Host machine fingerprint (e.g. "macOS-15.2-arm64") */
    hostFingerprint: z.string().optional(),
    /** Xcode version used for this baseline */
    xcodeVersion: z.string().optional(),
    /** CoreSimulator runtime identifier (e.g. "com.apple.CoreSimulator.SimRuntime.iOS-18-2") */
    runtimeIdentifier: z.string().optional(),
  })
  .strict();

export type BaselineRecord = z.infer<typeof BaselineRecordSchema>;

// ─── Build Baseline Key Input ────────────────────────────────

/**
 * Input to construct a baseline key.
 * The key format is: <projectId>|<targetKind>|<deviceModel>|<iosVersion>|<scenario>
 */
export const BuildBaselineKeyInputSchema = z
  .object({
    projectId: z.string().min(1),
    targetKind: TargetKindSchema,
    deviceModel: z.string().min(1),
    iosVersion: z.string().min(1),
    scenario: z.string().min(1),
  })
  .strict();

export type BuildBaselineKeyInput = z.infer<typeof BuildBaselineKeyInputSchema>;

// ─── Baseline List Filter ────────────────────────────────────

/**
 * Optional filter for listing baselines.
 */
export const BaselineListFilterSchema = z
  .object({
    targetKind: TargetKindSchema.optional(),
    projectId: z.string().optional(),
    scenario: z.string().optional(),
  })
  .strict()
  .optional();

export type BaselineListFilter = z.infer<typeof BaselineListFilterSchema>;

// ─── BaselineStore Interface ─────────────────────────────────

/**
 * BaselineStore — persistence layer for performance baselines.
 *
 * Stores JSON files at ~/.itestagent/baselines/<targetKind>/<key>.json.
 * Cross-domain guard: read/write operations validate that the targetKind
 * field matches the storage subdirectory (ADR-011).
 */
export interface BaselineStore {
  /**
   * Retrieve a baseline record by key.
   * Returns null if no baseline exists for this key.
   */
  get(key: string): Promise<BaselineRecord | null>;

  /**
   * Save (create or update) a baseline record.
   *
   * The record's targetKind field MUST match the storage subdirectory
   * that the key resolves to. Cross-domain saves are rejected.
   */
  save(record: BaselineRecord): Promise<void>;

  /**
   * List baseline records, optionally filtered.
   * Returns records sorted by updatedAt descending (most recent first).
   */
  list(filter?: BaselineListFilter): Promise<BaselineRecord[]>;

  /**
   * Delete a baseline record by key.
   * No-op if the key does not exist.
   */
  delete(key: string): Promise<void>;
}

// ─── Helper: Build Baseline Key ──────────────────────────────

/**
 * Build a deterministic baseline key from its components.
 *
 * Format: <projectId>|<targetKind>|<deviceModel>|<iosVersion>|<scenario>
 *
 * Sanitizes each component: replaces `|` with `-` to avoid delimiter collision.
 */
export function buildBaselineKey(input: BuildBaselineKeyInput): string {
  const sanitize = (s: string) => s.replace(/\|/g, '-');
  return [
    sanitize(input.projectId),
    sanitize(input.targetKind),
    sanitize(input.deviceModel),
    sanitize(input.iosVersion),
    sanitize(input.scenario),
  ].join('|');
}

/**
 * Parse a baseline key back into its components.
 * Returns null if the key format is invalid.
 */
export function parseBaselineKey(key: string): BuildBaselineKeyInput | null {
  const parts = key.split('|');
  if (parts.length !== 5) return null;

  const [projectId, targetKind, deviceModel, iosVersion, scenario] = parts;
  if (!projectId || !targetKind || !deviceModel || !iosVersion || !scenario) return null;

  const parsed = TargetKindSchema.safeParse(targetKind);
  if (!parsed.success) return null;

  return {
    projectId,
    targetKind: parsed.data,
    deviceModel,
    iosVersion,
    scenario,
  };
}
