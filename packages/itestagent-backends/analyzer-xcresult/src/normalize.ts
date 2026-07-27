/**
 * Normalization layer: maps parsed JUnit/xcresult data to iTestAgent contract types.
 *
 * AGENTS.md R5: JUnit timing is approximate. All derived metrics are marked approximate.
 * AGENTS.md R12: All code/comments in English.
 */

import type { PerformanceMetrics, RunStatus, TestCaseResult } from 'itestagent-contracts';

// ─── Internal JUnit Types ─────────────────────────────────────

/** A single parsed JUnit test case. */
export interface ParsedJUnitTest {
  /** Test method name. */
  name: string;
  /** Test class name (from classname attribute). */
  classname: string;
  /** Test duration in seconds (from time attribute). */
  time: number;
  /** Test outcome. */
  status: 'passed' | 'failed' | 'skipped';
  /** Failure message (only populated for failed tests). */
  failureMessage?: string;
}

/** Summary from the JUnit <testsuite> element. */
export interface JUnitSummary {
  /** Total number of tests in the suite. */
  totalTests: number;
  /** Number of passed tests. */
  passed: number;
  /** Number of failed tests (includes errors). */
  failed: number;
  /** Number of skipped tests. */
  skipped: number;
  /** Total suite time in seconds. */
  totalTime: number;
  /** Timestamp from the testsuite element (ISO 8601). */
  timestamp?: string;
}

// ─── Status Mapping ───────────────────────────────────────────

/**
 * Map a JUnit test status to a valid iTestAgent RunStatus.
 *
 * JUnit statuses:
 *   passed  → 'passed'
 *   failed  → 'failed'
 *   skipped → 'inconclusive' (RunStatusSchema has no 'skipped' value;
 *             'inconclusive' is the most honest mapping: the test was not run)
 */
function toRunStatus(junitStatus: string): RunStatus {
  switch (junitStatus) {
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'inconclusive';
    default:
      return 'passed';
  }
}

// ─── Normalizers ──────────────────────────────────────────────

/**
 * Normalize parsed JUnit tests to iTestAgent TestCaseResult[].
 *
 * @param parsedTests - Parsed JUnit test cases from the XML.
 * @returns Array of TestCaseResult objects.
 */
export function normalizeTestCases(parsedTests: ParsedJUnitTest[]): TestCaseResult[] {
  return parsedTests.map((t) => ({
    caseId: `${t.classname}/${t.name}`,
    name: t.name,
    status: toRunStatus(t.status),
    steps: [],
    durationMs: Math.round(t.time * 1000),
    error: t.failureMessage,
    artifacts: [],
  }));
}

/**
 * Build execution summary from JUnit summary and target names.
 *
 * @param summary - JUnit test suite summary.
 * @param targetNames - Target names extracted from --target-info.
 * @returns Execution summary object.
 */
export function normalizeExecution(
  summary: JUnitSummary,
  targetNames: string[],
): {
  startTime: string;
  endTime: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  targetNames: string[];
} {
  const endTime = new Date().toISOString();
  return {
    startTime: summary.timestamp ?? endTime,
    endTime,
    totalTests: summary.totalTests,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    targetNames,
  };
}

/**
 * Build performance metrics from JUnit summary.
 *
 * R5: JUnit timing is approximate — not raw xctrace.
 * Only `approximate: true` is guaranteed.
 *
 * @param _summary - JUnit test suite summary (totalTime unused — approximate only).
 * @returns PerformanceMetrics with approximate flag set.
 */
export function normalizeMetrics(_summary: JUnitSummary): PerformanceMetrics {
  const result: PerformanceMetrics = {
    approximate: true,
  };
  // R5: test duration from JUnit XML is approximate — not raw xctrace data.
  // Exact per-test durations are stored in each TestCaseResult.durationMs.
  return result;
}
