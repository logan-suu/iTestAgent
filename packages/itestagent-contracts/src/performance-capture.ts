import { z } from 'zod';
import type { ArtifactRef } from './device-types.js';
import type { PerformanceMetrics } from './run-result-contracts.js';

export const PerformanceMetricNameSchema = z.enum([
  'launch_time',
  'memory_peak',
  'memory_growth',
  'memory_leaks',
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
  /** Aborted when continuous capture fails; dependent actions must stop. */
  signal?: AbortSignal;
}

export interface PerformanceCaptureInput {
  memoryObservation?: { minimumDurationMs: number; settleDurationMs: number };
  /** Confirmed bundle identifier, required for Simulator host-process binding. */
  bundleId?: string;
  runId: string;
  deviceId: string;
  targetKind: 'physical' | 'simulator';
  /** Validated executable name or exact live PID, never a guessed bundle identifier. */
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

/** Carries only safe status and local artifact references, never raw tool output. */
export class PerformanceCaptureStartError extends Error {
  constructor(readonly result: PerformanceCaptureResult) {
    super('performance.preparation_failed');
    this.name = 'PerformanceCaptureStartError';
  }
}
