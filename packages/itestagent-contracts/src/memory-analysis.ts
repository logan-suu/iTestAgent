import { z } from 'zod';

/** Confirmed bounded observation, not permission to repeat application actions. */
export const MemoryObservationSchema = z.object({
  minimumDurationMs: z.number().int().min(1000).max(300_000),
  settleDurationMs: z.number().int().min(0).max(60_000),
});

export const MemorySampleSchema = z.object({
  timestampMs: z.number().finite().nonnegative(),
  footprintMiB: z.number().finite().nonnegative(),
});

export const MemoryGrowthSchema = z.object({
  source: z.literal('activity-monitor-process-live'),
  approximate: z.literal(true),
  scope: z.literal('observed_interval'),
  recordingDurationMs: z.number().finite().nonnegative().optional(),
  coverage: z.enum(['complete', 'partial']).optional(),
  samples: z.array(MemorySampleSchema).min(2).max(10000),
  sampleCount: z.number().int().min(2),
  startMiB: z.number().finite().nonnegative(),
  endMiB: z.number().finite().nonnegative(),
  peakMiB: z.number().finite().nonnegative(),
  deltaMiB: z.number().finite(),
  durationMs: z.number().finite().positive(),
  rateMiBPerMinute: z.number().finite(),
  direction: z.enum(['increased', 'decreased', 'unchanged']),
});

export type MemoryGrowth = z.infer<typeof MemoryGrowthSchema>;

/** Positive diagnostic evidence only. Empty exports cannot establish a successful zero-leak scan. */
export const MemoryLeaksSchema = z.object({
  source: z.literal('xctrace-leaks-detail'),
  status: z.literal('detected'),
  scope: z.literal('observed_allocations'),
  allocationCount: z.number().int().positive().max(10000),
  totalBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type MemoryLeaks = z.infer<typeof MemoryLeaksSchema>;
