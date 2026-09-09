import { z } from 'zod';
import { MetricCollectionOutcomeSchema } from './performance-capture.js';

/** Bounded sampling headroom, not a guarantee of valid exported sample coverage. */
export const MEMORY_CAPTURE_POLICY = {
  id: 'memory-observation-v2',
  samplingAllowanceMs: 30_000,
} as const;

/** Confirmed bounded observation, not permission to repeat application actions. */
export const MemoryObservationSchema = z.object({
  minimumDurationMs: z.number().int().min(1000).max(300_000),
  settleDurationMs: z.number().int().min(0).max(60_000),
});

export const MemorySampleSchema = z.object({
  timestampMs: z.number().finite().nonnegative(),
  footprintMiB: z.number().finite().nonnegative(),
  measurementDurationMs: z.number().finite().nonnegative().optional(),
});

export const MemoryGrowthSchema = z
  .object({
    source: z.enum(['activity-monitor-process-live', 'native-footprint']),
    sampleTimestamp: z.literal('host_command_completed').optional(),
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
  })
  .superRefine((value, ctx) => {
    if (
      value.source === 'native-footprint' &&
      (value.sampleTimestamp !== 'host_command_completed' ||
        value.samples.some((s) => s.measurementDurationMs === undefined))
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Native footprint requires command completion timestamps and measurement durations',
      });
  });

export type MemoryGrowth = z.infer<typeof MemoryGrowthSchema>;

/** Empty xctrace exports never establish a completed zero scan. */
const XctraceLeaksSchema = z.object({
  source: z.literal('xctrace-leaks-detail'),
  status: z.literal('detected'),
  scope: z.literal('observed_allocations'),
  allocationCount: z.number().int().positive().max(10000),
  totalBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const NativeLeaksSchema = z
  .object({
    source: z.literal('native-leaks'),
    status: z.enum(['detected', 'not_detected']),
    scope: z.literal('scan_snapshot'),
    allocationCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    totalBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    exitCode: z.union([z.literal(0), z.literal(1)]),
    completionVerified: z.literal(true),
    targetBound: z.literal(true),
    artifactId: z.string().min(1),
  })
  .strict();
export const MemoryLeaksSchema = z
  .discriminatedUnion('source', [XctraceLeaksSchema, NativeLeaksSchema])
  .superRefine((v, ctx) => {
    if (v.source !== 'native-leaks') return;
    if (
      Date.parse(v.finishedAt) < Date.parse(v.startedAt) ||
      (v.status === 'not_detected'
        ? v.exitCode !== 0 || v.allocationCount !== 0 || v.totalBytes !== 0
        : v.exitCode !== 1 || v.allocationCount <= 0 || v.totalBytes <= 0)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Native scan requires consistent completion, exit status, counts and timestamps',
      });
  });
export type MemoryLeaks = z.infer<typeof MemoryLeaksSchema>;

/** Reviewed replay identity and bounded repetition; no implicit exploration replay. */
export const MemoryRoundsPlanSchema = z
  .object({
    flowId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
    source: z.enum(['global', 'project']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    steps: z.array(z.string().min(1).max(500)).min(1).max(100),
    count: z.number().int().min(2).max(10),
    intervalMs: z.number().int().min(0).max(60_000),
    processPolicy: z.literal('same_process'),
  })
  .strict();
export type MemoryRoundsPlan = z.infer<typeof MemoryRoundsPlanSchema>;

export const MemoryRoundSchema = z
  .object({
    round: z.number().int().min(1).max(10),
    status: z.enum(['passed', 'failed', 'blocked', 'cancelled', 'inconclusive', 'not_started']),
    reasonCode: z.string().regex(/^[a-z0-9_.]+$/),
    startedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
    stepIds: z.array(z.string()),
    artifactIds: z.array(z.string()),
    memoryPeakMB: z.number().finite().nonnegative().optional(),
    memoryGrowth: MemoryGrowthSchema.optional(),
    memoryLeaks: MemoryLeaksSchema.optional(),
    collection: z.array(MetricCollectionOutcomeSchema).optional(),
  })
  .strict();
export const MemoryRoundsResultSchema = z
  .object({
    policy: z.literal('memory-rounds-v1'),
    status: z.enum(['passed', 'failed', 'blocked', 'cancelled', 'inconclusive']),
    plannedCount: z.number().int().min(2).max(10),
    rounds: z.array(MemoryRoundSchema).min(2).max(10),
    /** Last minus first observed round endpoint; never a sum of interval growth. */
    endpointDeltaMiB: z.number().finite().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.rounds.length !== value.plannedCount ||
      value.rounds.some((r, i) => r.round !== i + 1)
    )
      ctx.addIssue({ code: 'custom', message: 'rounds must cover the confirmed count in order' });
    if (value.status === 'passed' && value.rounds.some((r) => r.status !== 'passed'))
      ctx.addIssue({ code: 'custom', message: 'passed result requires every round to pass' });
    let stopped = false;
    for (const r of value.rounds) {
      if (stopped && r.status !== 'not_started')
        ctx.addIssue({
          code: 'custom',
          message: 'later rounds must not start after an unsuccessful round',
        });
      if (r.status !== 'passed') stopped = true;
      if (
        r.status !== 'not_started' &&
        (!r.startedAt || !r.finishedAt || Date.parse(r.finishedAt) < Date.parse(r.startedAt))
      )
        ctx.addIssue({ code: 'custom', message: 'attempted rounds require ordered timestamps' });
      if (
        r.status === 'passed' &&
        (!r.stepIds.length ||
          r.memoryGrowth?.coverage !== 'complete' ||
          !r.collection?.some((o) => o.metric === 'memory_growth' && o.status === 'collected'))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'passed rounds require actual steps and complete growth collection',
        });
      if (
        new Set(r.stepIds).size !== r.stepIds.length ||
        new Set(r.artifactIds).size !== r.artifactIds.length
      )
        ctx.addIssue({ code: 'custom', message: 'round references must be unique' });
      if (
        r.status === 'not_started' &&
        (r.startedAt ||
          r.finishedAt ||
          r.stepIds.length ||
          r.artifactIds.length ||
          r.memoryGrowth ||
          r.memoryPeakMB !== undefined ||
          r.memoryLeaks ||
          r.collection)
      )
        ctx.addIssue({ code: 'custom', message: 'unstarted rounds cannot claim execution facts' });
    }
    if (value.endpointDeltaMiB !== undefined) {
      const first = value.rounds[0]?.memoryGrowth?.endMiB;
      const last = value.rounds.at(-1)?.memoryGrowth?.endMiB;
      if (
        value.rounds.some(
          (r) => r.status !== 'passed' || r.memoryGrowth?.coverage !== 'complete',
        ) ||
        first === undefined ||
        last === undefined ||
        value.endpointDeltaMiB !== last - first
      )
        ctx.addIssue({
          code: 'custom',
          message: 'endpoint delta requires complete successful rounds and measured endpoints',
        });
    }
  });
export type MemoryRound = z.infer<typeof MemoryRoundSchema>;
export type MemoryRoundsResult = z.infer<typeof MemoryRoundsResultSchema>;
