/**
 * Internal types for the xcresult parser adapter.
 *
 * AGENTS.md R12: All code/comments in English.
 */

import type { ArtifactRef, PerformanceMetrics, TestCaseResult } from 'itestagent-contracts';

// ─── Options ──────────────────────────────────────────────────

/** Options for parsing an .xcresult bundle. */
export interface XcresultParserOptions {
  /** Path to the .xcresult bundle. */
  xcresultPath: string;
  /** Optional project root for relative path resolution. */
  projectRoot?: string;
  /** Whether to extract attachments (screenshots, etc.) via xcparse. */
  includeAttachments?: boolean;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

// ─── Result ───────────────────────────────────────────────────

/** Result of parsing an .xcresult bundle. */
export interface XcresultParseResult {
  /** Normalized test case results. */
  cases: TestCaseResult[];
  /** Execution summary metadata. */
  execution: {
    /** Test run start time (ISO 8601). */
    startTime: string;
    /** Test run end time (ISO 8601). */
    endTime: string;
    /** Total number of tests. */
    totalTests: number;
    /** Number of passed tests. */
    passed: number;
    /** Number of failed tests. */
    failed: number;
    /** Number of skipped tests. */
    skipped: number;
    /** Target names from --target-info. */
    targetNames: string[];
  };
  /**
   * Performance metrics.
   * R5: JUnit timing is approximate — not raw xctrace.
   * Only `approximate: true` is set; all other fields omitted.
   */
  metrics: PerformanceMetrics;
  /** Extracted attachment references (empty if includeAttachments is false). */
  attachments: ArtifactRef[];
  /**
   * Error message if CLI invocation failed.
   * R5: Explicit degradation — never throw on parse failures.
   */
  error?: string;
}

// ─── Dependency Injection ─────────────────────────────────────

/**
 * Signature for an asynchronous subprocess spawn function.
 * Mirrors the DI pattern from build-xcodebuild.
 */
export type SpawnAsyncFn = (
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    signal?: AbortSignal;
    env?: Record<string, string>;
  },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** Injectable dependencies for the xcresult parser adapter. */
export interface XcresultParserDeps {
  spawnAsync: SpawnAsyncFn;
}
