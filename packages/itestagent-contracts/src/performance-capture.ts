import { z } from 'zod';
import type { ArtifactRef } from './device-types.js';
import type { PerformanceMetrics } from './run-result-contracts.js';

export const PerformanceMetricNameSchema = z.enum([
  'launch_time',
  'memory_peak',
  'crash',
  'test_duration',
  'hitches',
  'fps',
  'xctrace_summary',
]);
export const MetricCollectionOutcomeSchema = z.object({
  metric: PerformanceMetricNameSchema,
  status: z.enum(['collected', 'not_exportable', 'failed', 'cancelled']),
  /** Stable, non-sensitive reason; never raw subprocess output. */
  reasonCode: z.string().regex(/^[a-z0-9_.]+$/),
});
export type MetricCollectionOutcome = z.infer<typeof MetricCollectionOutcomeSchema>;

export interface PerformanceCaptureResult {
  metrics: PerformanceMetrics;
  artifacts: ArtifactRef[];
}

/** Backend owns its processes; finish is idempotent and waits for teardown. */
export interface PerformanceCapture {
  finish(): Promise<PerformanceCaptureResult>;
}

export interface PerformanceCaptureInput {
  runId: string;
  deviceId: string;
  targetKind: 'physical' | 'simulator';
  /** Validated executable name, NOT a guessed bundle identifier. */
  executable: string;
  stagingDir: string;
  metrics: MetricCollectionOutcome['metric'][];
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** Resolves only after recording readiness, or rejects after owned-process cleanup. */
export type PerformanceCaptureFactory = (
  input: PerformanceCaptureInput,
) => Promise<PerformanceCapture>;
