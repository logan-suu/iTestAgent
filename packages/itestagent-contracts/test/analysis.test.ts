/**
 * analysis.test.ts — B05 core profiling-analysis contracts (promotion guide
 * §11.3 "scenario subpath", §6.2: the CORE keeps run identity, profiling
 * services and typed outcomes while scenario specifics move behind the
 * scenarios subpath).
 *
 * analysis.ts is deliberately product-neutral: it consumes metric samples
 * and thresholds, never app identity.
 */
import { describe, expect, it } from 'bun:test';
import type { ThresholdFinding } from '../src/analysis.js';
import {
  MemoryProfileSummarySchema,
  MetricSampleSchema,
  ThresholdFindingSchema,
  analyzeMemorySamples,
  evaluateThresholds,
} from '../src/analysis.js';

function samplesOf(
  values: number[],
  intervalMs = 1000,
): Array<{ timestampMs: number; valueMB: number }> {
  return values.map((valueMB, index) => ({ timestampMs: index * intervalMs, valueMB }));
}

describe('MetricSampleSchema', () => {
  it('accepts a timestamped sample', () => {
    const parsed = MetricSampleSchema.parse({ timestampMs: 0, valueMB: 12.5 });
    expect(parsed.valueMB).toBe(12.5);
  });

  it('rejects negative timestamps or values', () => {
    expect(MetricSampleSchema.safeParse({ timestampMs: -1, valueMB: 1 }).success).toBe(false);
    expect(MetricSampleSchema.safeParse({ timestampMs: 0, valueMB: -0.5 }).success).toBe(false);
  });
});

describe('analyzeMemorySamples', () => {
  it('computes peak/average/sampleCount over a series', () => {
    const summary = analyzeMemorySamples(samplesOf([10, 20, 30, 25]));
    expect(summary.peakMB).toBe(30);
    expect(summary.avgMB).toBeCloseTo(21.25);
    expect(summary.sampleCount).toBe(4);
    expect(summary.durationMs).toBe(3000);
  });

  it('reports linear growth rate in MB per minute', () => {
    // +10 MB every second for 3 seconds ≈ 200 MB/min growth slope.
    const summary = analyzeMemorySamples(samplesOf([10, 20, 30, 40]));
    expect(summary.growthRateMBPerMin).toBeGreaterThan(150);
  });

  it('handles a single sample without growth rate (R5: nothing fabricated)', () => {
    const summary = analyzeMemorySamples(samplesOf([42]));
    expect(summary.peakMB).toBe(42);
    expect(summary.growthRateMBPerMin).toBeUndefined();
  });

  it('rejects an empty series instead of returning zeros', () => {
    expect(() => analyzeMemorySamples([])).toThrow();
  });

  it('output satisfies MemoryProfileSummarySchema', () => {
    const summary = analyzeMemorySamples(samplesOf([5, 6, 7]));
    expect(MemoryProfileSummarySchema.safeParse(summary).success).toBe(true);
  });
});

describe('evaluateThresholds', () => {
  it('breaches when observed exceeds threshold', () => {
    const findings = evaluateThresholds(
      [{ metric: 'memory_peak_mb', observed: 25 }],
      [{ metric: 'memory_peak_mb', threshold: 20 }],
    );
    expect(findings).toHaveLength(1);
    const finding = findings[0] as ThresholdFinding;
    expect(finding.breached).toBe(true);
    expect(finding.observed).toBe(25);
  });

  it('passes when observed is within threshold', () => {
    const findings = evaluateThresholds(
      [{ metric: 'memory_peak_mb', observed: 18 }],
      [{ metric: 'memory_peak_mb', threshold: 20 }],
    );
    expect(findings[0]?.breached).toBe(false);
  });

  it('skips thresholds without a matching observation (nothing invented)', () => {
    const findings = evaluateThresholds([], [{ metric: 'memory_peak_mb', threshold: 20 }]);
    expect(findings).toEqual([]);
  });
});
