/**
 * iTestAgent doctor types — Physical readiness check definitions.
 *
 * US-1.2 AC1: pass / fail / manual three-state per check item.
 * US-1.2 AC3: single failure does not interrupt overall diagnosis.
 * US-1.2 AC4: structured report readable by engine.
 *
 * AGENTS.md §5: doctor results are part of ~/.itestagent/run diagnostics,
 * not persisted as permanent artifacts — they live in memory + CLI output.
 */

/** Three-state check result per US-1.2 AC1. */
export type DoctorCheckStatus = 'pass' | 'fail' | 'manual';

/** Single check result with optional fix guidance per US-1.2 AC2 + US-1.3 AC2. */
export interface DoctorCheckResult {
  /** Human-readable check name (e.g. "Xcode") */
  name: string;
  /** Three-state status per US-1.2 AC1 */
  status: DoctorCheckStatus;
  /** One-line status message */
  message: string;
  /** Executable fix guidance (commands or phone-side steps) — only for fail/manual */
  fixGuide?: string[];
  /** Additional diagnostic details (version numbers, paths, raw output) */
  details?: string;
}

/** Aggregate result from all doctor checks, engine-readable per US-1.2 AC4. */
export interface DoctorReport {
  /** Individual check results */
  checks: DoctorCheckResult[];
  /** Quick count summary */
  summary: {
    pass: number;
    fail: number;
    manual: number;
    total: number;
  };
  /** Whether all automated checks passed (manual counts as neutral) */
  healthy: boolean;
  /** Estimated first-run time hint (US-1.3 AC3: 15-30 minutes) */
  estimatedSetupMinutes?: number;
}
