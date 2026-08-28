import { z } from 'zod';

/**
 * Profiling-analysis contracts — B05 core slice (promotion guide §11.3
 * "scenario subpath"; §6.2: the CORE keeps profiling services and typed
 * outcomes while scenario specifics live behind the scenarios subpath).
 *
 * This module is deliberately PRODUCT-NEUTRAL (enforced by
 * scenario-isolation.test.ts): it speaks only of samples, summaries and
 * thresholds — never of app identity, feed locators or calibration brands.
 * R5 applies to every derived number here: nothing is fabricated; a summary
 * that cannot be computed from real samples fails loudly instead of
 * returning zeros.
 */

// ─── Samples ─────────────────────────────────────────────────

export const MetricSampleSchema = z
  .object({
    /** Sample timestamp, milliseconds since run start (non-negative). */
    timestampMs: z.number().nonnegative(),
    /** Measured value in megabytes (non-negative). */
    valueMB: z.number().nonnegative(),
  })
  .strict();

export type MetricSample = z.infer<typeof MetricSampleSchema>;

// ─── Summary ─────────────────────────────────────────────────

export const MemoryProfileSummarySchema = z
  .object({
    peakMB: z.number().nonnegative(),
    avgMB: z.number().nonnegative(),
    sampleCount: z.number().int().positive(),
    durationMs: z.number().nonnegative(),
    /**
     * Linear-regression slope expressed in MB per minute.
     * Undefined for series too short to have a slope (single sample) —
     * never guessed (R5).
     */
    growthRateMBPerMin: z.number().optional(),
  })
  .strict();

export type MemoryProfileSummary = z.infer<typeof MemoryProfileSummarySchema>;

/**
 * Computes a memory-profile summary from real samples.
 * Throws on an empty series — an absent measurement must not become a zero.
 */
export function analyzeMemorySamples(samples: readonly MetricSample[]): MemoryProfileSummary {
  if (samples.length === 0) {
    throw new Error('analyzeMemorySamples requires at least one sample (R5: no fabricated data)');
  }

  let peakMB = Number.NEGATIVE_INFINITY;
  let totalMB = 0;
  for (const sample of samples) {
    if (sample.valueMB > peakMB) peakMB = sample.valueMB;
    totalMB += sample.valueMB;
  }
  const avgMB = totalMB / samples.length;

  // length >= 1 guaranteed by the empty check above.
  const first = samples[0] as MetricSample;
  const last = samples[samples.length - 1] as MetricSample;
  const durationMs = last.timestampMs - first.timestampMs;

  const growthRateMBPerMin =
    samples.length >= 2 && durationMs > 0 ? linearSlopeMBPerMin(samples) : undefined;

  return { peakMB, avgMB, sampleCount: samples.length, durationMs, growthRateMBPerMin };
}

/** Least-squares slope over (time-minutes, MB), robust for uniform sampling. */
function linearSlopeMBPerMin(samples: readonly MetricSample[]): number {
  // Only invoked with length >= 2 (see analyzeMemorySamples).
  const t0 = (samples[0] as MetricSample).timestampMs;
  const points = samples.map((sample) => ({
    x: (sample.timestampMs - t0) / 60_000,
    y: sample.valueMB,
  }));
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

// ─── Threshold evaluation ────────────────────────────────────

export interface MetricObservation {
  metric: string;
  observed: number;
}

export const ThresholdFindingSchema = z
  .object({
    metric: z.string(),
    observed: z.number(),
    threshold: z.number(),
    breached: z.boolean(),
  })
  .strict();

export type ThresholdFinding = z.infer<typeof ThresholdFindingSchema>;

/**
 * Evaluates observations against thresholds.
 * Only thresholds with a matching observation produce findings — absent
 * measurements are reported as absent by the caller, never invented here.
 */
export function evaluateThresholds(
  observations: readonly MetricObservation[],
  thresholds: readonly { metric: string; threshold: number }[],
): ThresholdFinding[] {
  const findings: ThresholdFinding[] = [];
  for (const threshold of thresholds) {
    const observation = observations.find((candidate) => candidate.metric === threshold.metric);
    if (!observation) continue;
    findings.push(
      ThresholdFindingSchema.parse({
        metric: threshold.metric,
        observed: observation.observed,
        threshold: threshold.threshold,
        breached: observation.observed > threshold.threshold,
      }),
    );
  }
  return findings;
}
