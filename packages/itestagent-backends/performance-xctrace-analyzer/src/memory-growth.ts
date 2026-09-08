import type { MemoryGrowth } from 'itestagent-contracts';

/** Observed interval facts only: no pass/fail threshold and no inference of leaks. */
export function analyzeMemoryGrowth(samples: MemoryGrowth['samples']): MemoryGrowth | undefined {
  if (samples.length < 2 || samples.length > 10000) return;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (
      !s ||
      !Number.isFinite(s.timestampMs) ||
      s.timestampMs < 0 ||
      !Number.isFinite(s.footprintMiB) ||
      s.footprintMiB < 0 ||
      (i > 0 && s.timestampMs <= (samples[i - 1]?.timestampMs ?? Number.POSITIVE_INFINITY))
    )
      return;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return;
  const durationMs = last.timestampMs - first.timestampMs;
  const deltaMiB = last.footprintMiB - first.footprintMiB;
  const rateMiBPerMinute = (deltaMiB / durationMs) * 60000;
  if (!Number.isFinite(rateMiBPerMinute)) return;
  return {
    source: 'activity-monitor-process-live',
    approximate: true,
    scope: 'observed_interval',
    samples: samples.map((s) => ({ ...s })),
    sampleCount: samples.length,
    startMiB: first.footprintMiB,
    endMiB: last.footprintMiB,
    peakMiB: Math.max(...samples.map((s) => s.footprintMiB)),
    deltaMiB,
    durationMs,
    rateMiBPerMinute,
    direction: deltaMiB > 0 ? 'increased' : deltaMiB < 0 ? 'decreased' : 'unchanged',
  };
}
