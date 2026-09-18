import { MemoryRoundsResultSchema } from './memory-analysis.js';
import type { PerformanceMetrics } from './run-result-contracts.js';
import type { TestPlan } from './test-plan.js';

/** Validate evidence against the confirmed sampling policy, before persistence or baseline use. */
export function memoryRoundsMetricIssues(plan: TestPlan, metrics: PerformanceMetrics): string[] {
  const config = plan.performance.memoryRounds;
  const result = metrics.memoryRounds;
  if (!result) return config ? ['memory_rounds.result_missing'] : [];
  if (!config) return ['memory_rounds.plan_missing'];
  const issues: string[] = [];
  if (!MemoryRoundsResultSchema.safeParse(result).success)
    issues.push('memory_rounds.invalid_result');
  if (result.plannedCount !== config.count) issues.push('memory_rounds.count_mismatch');
  if (metrics.memoryGrowth || metrics.memoryLeaks) issues.push('memory_rounds.invalid_aggregate');
  const requested = (plan.execution.metrics ?? []).filter((m) => m !== 'test_duration');
  for (const row of result.rounds) {
    const g = row.memoryGrowth;
    if (g?.source === 'native-footprint' || row.memoryLeaks?.source === 'native-leaks')
      issues.push('memory_rounds.native_source_unsupported');
    if (g) {
      const first = g.samples[0];
      const last = g.samples.at(-1);
      const delta = g.endMiB - g.startMiB;
      if (
        !first ||
        !last ||
        g.sampleCount !== g.samples.length ||
        g.samples.some((s, i) => i > 0 && s.timestampMs <= (g.samples[i - 1]?.timestampMs ?? 0)) ||
        g.durationMs !== last.timestampMs - first.timestampMs ||
        g.startMiB !== first.footprintMiB ||
        g.endMiB !== last.footprintMiB ||
        g.peakMiB !== Math.max(...g.samples.map((s) => s.footprintMiB)) ||
        Math.abs(g.deltaMiB - delta) > 1e-6 ||
        Math.abs(g.rateMiBPerMinute - (delta * 60_000) / g.durationMs) > 1e-6
      )
        issues.push('memory_rounds.inconsistent_samples');
    }
    if (row.status !== 'passed') continue;
    if (
      !g ||
      g.coverage !== 'complete' ||
      g.durationMs < (plan.performance.memoryObservation?.minimumDurationMs ?? 1000)
    )
      issues.push('memory_rounds.incomplete_coverage');
    if (
      requested.some(
        (m) => !row.collection?.some((o) => o.metric === m && o.status === 'collected'),
      )
    )
      issues.push('memory_rounds.incomplete_collection');
    if (requested.includes('memory_peak') && row.memoryPeakMB === undefined)
      issues.push('memory_rounds.peak_missing');
    if (requested.includes('memory_leaks') && !row.memoryLeaks)
      issues.push('memory_rounds.leaks_missing');
  }
  const peaks = result.rounds.flatMap((r) =>
    r.memoryPeakMB === undefined ? [] : [r.memoryPeakMB],
  );
  if (
    peaks.length &&
    (metrics.memoryPeakMB !== Math.max(...peaks) || metrics.memoryPeakUnit !== 'MiB')
  )
    issues.push('memory_rounds.peak_mismatch');
  if (result.status === 'passed' && result.endpointDeltaMiB === undefined)
    issues.push('memory_rounds.endpoint_missing');
  return [...new Set(issues)];
}
