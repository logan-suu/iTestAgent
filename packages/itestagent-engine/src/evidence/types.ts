/**
 * Evidence collection types — contracts for EvidenceCollector.
 *
 * Task 4.1: US-13.1 automatic evidence collection on failure.
 * AC1: screenshot / video / syslog / crashlog / xcresult / trace
 * AC2: evidence linked to specific run step / case
 * AC3: crashlog symbolication via xctrace symbolicate / LLVM crashlog tools
 *
 * These are plain TypeScript types (not Zod schemas) for internal use.
 * Output artifacts are validated via itestagent-contracts ArtifactRef/ArtifactIndex schemas.
 */

import type { ArtifactRef } from 'itestagent-contracts';

// ─── Evidence Type ──────────────────────────────────────────────

/** Six evidence categories per US-13.1 AC1. */
export type EvidenceType = 'screenshot' | 'video' | 'syslog' | 'crashlog' | 'xcresult' | 'trace';

// ─── Evidence Options ───────────────────────────────────────────

/**
 * Options passed to EvidenceCollector.collectOnFailure().
 *
 * targetKind determines the strategy:
 *   - simulator → simctl-based evidence (faster, no Appium session needed)
 *   - physical   → DeviceBackend methods + devicectl diagnostics
 */
export interface EvidenceOptions {
  /** Device UDID. */
  deviceId: string;

  /** Target kind per ADR-011. */
  targetKind: 'physical' | 'simulator';

  /** Run step ID to associate evidence with (AC2). */
  stepId: string;

  /** Run directory (`~/.itestagent/runs/<run_id>/`). Artifacts stored under `<runDir>/artifacts/`. */
  runDir: string;

  /** Backend name for artifact metadata (e.g. 'appium', 'mock'). */
  backendName?: string;

  /** App bundle ID (used for syslog filtering). */
  bundleId?: string;

  /** Path to xcresult bundle to collect (if XCUITest path was used). */
  xcresultPath?: string;

  /** Path to trace file to collect (if performance profiling was active). */
  tracePath?: string;

  /** Whether video recording is currently active (skip video collection if false). */
  recordingActive?: boolean;

  /** Whether to attempt crashlog symbolication (AC3). Default: true. */
  attemptSymbolication?: boolean;

  /** Path to dSYM directory for crashlog symbolication. Auto-searched if omitted. */
  dsymPath?: string;

  /** AbortSignal for cancellation (DEF-015 note: full DeviceBackend propagation is deferred). */
  signal?: AbortSignal;
}

// ─── Evidence Result ────────────────────────────────────────────

/**
 * Result of a single evidence collection attempt.
 *
 * R5 compliance: every collection result is explicit about success/failure.
 * No silent degradation — absent evidence is explicitly marked as not_collected.
 */
export interface EvidenceResult {
  /** Evidence type. */
  type: EvidenceType;

  /** Whether this evidence was successfully collected. */
  collected: boolean;

  /** The artifact reference (only set when collected === true). */
  artifact?: ArtifactRef;

  /** Why collection failed (R5: explicit, not silent). */
  reason?: string;

  /** Whether the evidence is symbolic (AC3). */
  symbolicated?: boolean;
}

// ─── Collector Config ───────────────────────────────────────────

/**
 * Configuration for EvidenceCollector construction.
 */
export interface EvidenceCollectorConfig {
  /** Timeout per evidence collection attempt (ms). Default: 15000. */
  perEvidenceTimeoutMs?: number;

  /** Whether to throw on collection errors (vs. return not_collected). Default: false. */
  throwOnError?: boolean;
}

// ─── Collector Summary ──────────────────────────────────────────

/**
 * Full collection result summarizing all evidence gathered for a failed step.
 */
export interface EvidenceCollectionSummary {
  /** The step ID this evidence is associated with (AC2). */
  stepId: string;

  /** Individual evidence results. */
  results: EvidenceResult[];

  /** Artifact references for all successfully collected evidence. */
  artifacts: ArtifactRef[];

  /** Total evidence collected (count of collected === true). */
  collectedCount: number;

  /** Total evidence types attempted. */
  totalTypes: number;
}
