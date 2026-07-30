import type {
  BaselineDelta,
  BaselineRecord,
  BaselineStore,
  BuildBaselineKeyInput,
  RunStatus,
  TraceSummary,
} from 'itestagent-contracts';
import { buildBaselineKey } from 'itestagent-contracts';

// ─── Types ─────────────────────────────────────────────────

/**
 * Input context for building a baseline key.
 *
 * Maps to BuildBaselineKeyInput: <projectId>|<targetKind>|<deviceModel>|<iosVersion>|<scenario>
 */
export interface BaselineKeyContext {
  projectId: string;
  targetKind: 'physical' | 'simulator';
  deviceModel: string;
  iosVersion: string;
  scenario: string;
}

/**
 * Extended context for establishing a new baseline.
 *
 * Includes simulator-only metadata per ADR-011 §6:
 * hostFingerprint, xcodeVersion, runtimeIdentifier.
 */
export interface EstablishBaselineContext extends BaselineKeyContext {
  /** Run ID that produced this baseline. */
  runId: string;
  /** Host machine fingerprint (e.g. "macOS-15.2-arm64"). Simulator-only. */
  hostFingerprint?: string;
  /** Xcode version used. Simulator-only. */
  xcodeVersion?: string;
  /** CoreSimulator runtime identifier (e.g. "com.apple.CoreSimulator.SimRuntime.iOS-18-2"). Simulator-only. */
  runtimeIdentifier?: string;
}

/**
 * Context for comparing a current run against an existing baseline.
 */
export interface CompareBaselineContext {
  runId: string;
  projectId: string;
  targetKind: 'physical' | 'simulator';
  deviceModel: string;
  iosVersion: string;
  scenario: string;
}

// ─── BaselineManager ────────────────────────────────────────

/**
 * BaselineManager — engine-layer orchestrator for baseline lifecycle.
 *
 * Responsibilities:
 * - Deciding when to establish / update a baseline (shouldEstablishBaseline)
 * - Creating new baselines from TraceSummary and run context (establishBaseline)
 * - Comparing current performance against stored baselines (compareWithBaseline)
 * - Accepting and persisting new baseline records (acceptNewBaseline)
 *
 * AGENTS.md §6 Domain Rules:
 *   First successful run establishes baseline; failures/crashes do not.
 *   Subsequent runs produce trend comparison.
 *   Accepting a new baseline requires user confirmation (PermissionEngine handles gate).
 *
 * ADR-011 §6: physical and simulator baselines are strictly domain-isolated.
 */
export class BaselineManager {
  private readonly baselineStore: BaselineStore;

  constructor(deps: { baselineStore: BaselineStore }) {
    this.baselineStore = deps.baselineStore;
  }

  // ── Key Construction ──────────────────────────────────────

  /**
   * Build a deterministic baseline key from run context.
   *
   * Delegates to contracts' buildBaselineKey().
   * Format: <projectId>|<targetKind>|<deviceModel>|<iosVersion>|<scenario>
   */
  buildBaselineKeyFromContext(context: BaselineKeyContext): string {
    const input: BuildBaselineKeyInput = {
      projectId: context.projectId,
      targetKind: context.targetKind,
      deviceModel: context.deviceModel,
      iosVersion: context.iosVersion,
      scenario: context.scenario,
    };
    return buildBaselineKey(input);
  }

  // ── Gate ──────────────────────────────────────────────────

  /**
   * Determine whether a run result qualifies for establishing a baseline.
   *
   * AC2: First successful run establishes baseline ('passed' or 'explored').
   * AC5: crash / functional failure / execution failure do NOT establish
   *      ('failed', 'inconclusive', 'needs_assertion', 'flaky', 'blocked').
   */
  shouldEstablishBaseline(runResult: { status: RunStatus }): boolean {
    switch (runResult.status) {
      case 'passed':
      case 'explored':
        return true;
      case 'failed':
      case 'inconclusive':
      case 'needs_assertion':
      case 'flaky':
      case 'blocked':
        return false;
      default:
        // Exhaustiveness: unknown future status — do not establish
        return false;
    }
  }

  // ── Establish Baseline ────────────────────────────────────

  /**
   * Establish a new baseline from a TraceSummary and run context.
   *
   * Creates a BaselineRecord with metrics extracted from the summary.
   * Populates simulator-only metadata when targetKind='simulator' (ADR-011 §6).
   * Persists via BaselineStore.save().
   */
  async establishBaseline(
    summary: TraceSummary,
    context: EstablishBaselineContext,
  ): Promise<BaselineRecord> {
    const key = this.buildBaselineKeyFromContext(context);
    const now = new Date().toISOString();

    const record: BaselineRecord = {
      schemaVersion: 2 as const,
      key,
      targetKind: context.targetKind,
      launchDurationMs: summary.launchDurationMs,
      memoryPeakMB: summary.memoryPeakMB,
      hangCount: summary.hangCount,
      hitchesSummary: summary.hitchesSummary,
      fpsApproximate: summary.fpsApproximate,
      approximate: summary.approximate ?? true,
      updatedFromRun: context.runId,
      createdAt: now,
      updatedAt: now,
      reachableRuns: [context.runId],
    };

    // ADR-011 §6: simulator baselines carry additional metadata
    if (context.targetKind === 'simulator') {
      record.comparisonScope = 'simulator_only';
      record.representativeOfPhysicalDevice = false;
      record.hostFingerprint = context.hostFingerprint;
      record.xcodeVersion = context.xcodeVersion;
      record.runtimeIdentifier = context.runtimeIdentifier;
    }

    await this.baselineStore.save(record);
    return record;
  }

  // ── Compare Against Baseline ──────────────────────────────

  /**
   * Compare a current TraceSummary against the stored baseline for the given context.
   *
   * Returns a BaselineDelta with per-metric delta values:
   * - launchDurationMs, memoryPeakMB, hangCount: positive = regression
   * - fpsApproximate: negative = regression (FPS drop)
   * - hitches: string comparison (improved/regressed/unchanged/inconclusive)
   *
   * If no baseline exists, returns an inconclusive delta.
   * Overall summary is the worst-case across all comparable metrics.
   */
  async compareWithBaseline(
    summary: TraceSummary,
    context: CompareBaselineContext,
  ): Promise<BaselineDelta> {
    const key = this.buildBaselineKeyFromContext(context);
    const now = new Date().toISOString();

    const baseline = await this.baselineStore.get(key);

    // No baseline exists → inconclusive
    if (!baseline) {
      return {
        baselineId: key,
        runId: context.runId,
        comparedAt: now,
        targetKind: context.targetKind,
        deltas: {},
        summary: 'inconclusive',
      };
    }

    // Compute per-metric deltas
    const launchDurationMs = computeNumericDelta(
      summary.launchDurationMs,
      baseline.launchDurationMs,
    );
    const memoryPeakMB = computeNumericDelta(summary.memoryPeakMB, baseline.memoryPeakMB);
    const hangCount = computeNumericDelta(summary.hangCount, baseline.hangCount);
    const fpsApproximate = computeNumericDelta(summary.fpsApproximate, baseline.fpsApproximate);
    const hitches = computeHitchesDelta(summary.hitchesSummary, baseline.hitchesSummary);

    // Determine overall summary
    const deltaSummary = computeOverallSummary(
      launchDurationMs,
      memoryPeakMB,
      hangCount,
      fpsApproximate,
      hitches,
    );

    const deltas: BaselineDelta['deltas'] = {};
    if (launchDurationMs !== undefined) deltas.launchDurationMs = launchDurationMs;
    if (memoryPeakMB !== undefined) deltas.memoryPeakMB = memoryPeakMB;
    if (hangCount !== undefined) deltas.hangCount = hangCount;
    if (hitches !== undefined) deltas.hitches = hitches;
    if (fpsApproximate !== undefined) deltas.fpsApproximate = fpsApproximate;

    return {
      baselineId: key,
      runId: context.runId,
      comparedAt: now,
      targetKind: context.targetKind,
      deltas,
      summary: deltaSummary,
    };
  }

  // ── Accept New Baseline ───────────────────────────────────

  /**
   * Accept a new baseline by updating an existing record with the given run ID.
   *
   * AC4: User confirms accepting new baseline.
   * R7: Accepting a new baseline requires user confirmation.
   * Pass `confirmed: true` to proceed. Throws if called without explicit confirmation.
   *
   * Prepends runId to reachableRuns and bumps updatedAt.
   * Returns null if no baseline exists for the key.
   */
  async acceptNewBaseline(
    runId: string,
    key: string,
    confirmed?: boolean,
  ): Promise<BaselineRecord | null> {
    // R7: baseline acceptance requires explicit user confirmation
    if (confirmed !== true) {
      throw new Error(
        'R7: Accepting a new baseline requires user confirmation. ' +
          'Pass confirmed: true to proceed.',
      );
    }

    const existing = await this.baselineStore.get(key);
    if (!existing) return null;

    const updated: BaselineRecord = {
      ...existing,
      updatedFromRun: runId,
      updatedAt: new Date().toISOString(),
      reachableRuns: [runId, ...existing.reachableRuns],
    };

    await this.baselineStore.save(updated);
    return updated;
  }
}

// ─── Internal Helpers ───────────────────────────────────────

/**
 * Compute the delta between two numeric values.
 * Returns undefined if either value is not available.
 */
function computeNumericDelta(
  current: number | undefined,
  baselineValue: number | undefined,
): number | undefined {
  if (current === undefined || baselineValue === undefined) return undefined;
  return current - baselineValue;
}

/**
 * Compare hitches between current and baseline.
 *
 * Handles numeric comparisons (lower is better).
 * Returns 'inconclusive' for non-comparable formats.
 */
function computeHitchesDelta(
  current: unknown,
  baselineValue: unknown,
): 'improved' | 'regressed' | 'unchanged' | 'inconclusive' | undefined {
  if (
    current === undefined ||
    baselineValue === undefined ||
    current === null ||
    baselineValue === null
  ) {
    return undefined;
  }

  // If both are numbers, compare directly (lower = better)
  if (typeof current === 'number' && typeof baselineValue === 'number') {
    if (current < baselineValue) return 'improved';
    if (current > baselineValue) return 'regressed';
    return 'unchanged';
  }

  // Non-numeric hitches are not comparable
  return 'inconclusive';
}

/**
 * Compute the overall summary across all metric deltas.
 *
 * Semantic rules:
 * - launchDurationMs: positive = regression (took longer)
 * - memoryPeakMB: positive = regression (used more memory)
 * - hangCount: positive = regression (more hangs)
 * - fpsApproximate: negative = regression (FPS dropped)
 * - hitches: 'regressed'/string value
 *
 * Overall summary reflects the worst-case:
 * - Any regression → 'regressed'
 * - Any improvement (and no regression) → 'improved'
 * - All metrics unchanged → 'unchanged'
 * - No comparable metrics → 'inconclusive'
 */
function computeOverallSummary(
  launchDurationMs: number | undefined,
  memoryPeakMB: number | undefined,
  hangCount: number | undefined,
  fpsApproximate: number | undefined,
  hitches: 'improved' | 'regressed' | 'unchanged' | 'inconclusive' | undefined,
): 'improved' | 'regressed' | 'unchanged' | 'inconclusive' {
  let hasRegression = false;
  let hasImprovement = false;
  let hasAnyMetric = false;

  // launchDurationMs: positive → regression
  if (launchDurationMs !== undefined) {
    hasAnyMetric = true;
    if (launchDurationMs > 0) hasRegression = true;
    else if (launchDurationMs < 0) hasImprovement = true;
  }

  // memoryPeakMB: positive → regression
  if (memoryPeakMB !== undefined) {
    hasAnyMetric = true;
    if (memoryPeakMB > 0) hasRegression = true;
    else if (memoryPeakMB < 0) hasImprovement = true;
  }

  // hangCount: positive → regression
  if (hangCount !== undefined) {
    hasAnyMetric = true;
    if (hangCount > 0) hasRegression = true;
    else if (hangCount < 0) hasImprovement = true;
  }

  // fpsApproximate: negative → regression (FPS drop)
  if (fpsApproximate !== undefined) {
    hasAnyMetric = true;
    if (fpsApproximate < 0) hasRegression = true;
    else if (fpsApproximate > 0) hasImprovement = true;
  }

  // hitches: string comparison
  if (hitches !== undefined) {
    hasAnyMetric = true;
    if (hitches === 'regressed') hasRegression = true;
    else if (hitches === 'improved') hasImprovement = true;
  }

  if (!hasAnyMetric) return 'inconclusive';
  if (hasRegression) return 'regressed';
  if (hasImprovement) return 'improved';
  return 'unchanged';
}
