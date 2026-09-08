import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  MetricCollectionOutcome,
  PerformanceCaptureFactory,
  PerformanceCaptureInput,
  PerformanceCaptureResult,
  PerformanceMetrics,
} from 'itestagent-contracts';
import { MemoryObservationSchema } from 'itestagent-contracts';
import { parseActivityMonitorMemory } from './activity-monitor-memory.js';
import { startCaptureProcess } from './capture-process.js';
import { parseLeaksDetail } from './leaks-detail.js';
import { parsePerformanceMetrics } from './metrics-parser.js';
import { waitForObservation } from './observation-wait.js';

const FIELDS = {
  launch_time: 'launchDurationMs',
  memory_peak: 'memoryPeakMB',
  memory_growth: 'memoryGrowth',
  memory_leaks: 'memoryLeaks',
  crash: 'crashDetected',
  hitches: 'hitchesSummary',
  fps: 'fpsApproximate',
  test_duration: 'testDurationMs',
} as const;

function unavailable(input: PerformanceCaptureInput, reasonCode: string): PerformanceCaptureResult {
  return {
    artifacts: [],
    metrics: {
      collection: input.metrics.map((metric) => ({
        metric,
        status: input.signal?.aborted ? 'cancelled' : 'failed',
        reasonCode,
      })),
    },
  };
}

/**
 * One confirmed execution interval, one trace. No automatic relaunch or template fallback.
 * Unsupported schemas remain not_exportable; allocation totals are not process footprint.
 */
export function createProductionPerformanceCapture(
  spawn: typeof startCaptureProcess = startCaptureProcess,
): PerformanceCaptureFactory {
  return async (input) => {
    input.signal?.throwIfAborted();
    const observation = input.memoryObservation
      ? MemoryObservationSchema.parse(input.memoryObservation)
      : undefined;
    const progress = (message: string) => {
      try {
        input.onProgress?.(message);
      } catch {
        /* UI observers must not interrupt process teardown. */
      }
    };
    const dir = join(input.stagingDir, 'performance');
    mkdirSync(dir, { recursive: true });
    const trace = join(dir, 'execution.trace');
    const memoryRequested = input.metrics.some((m) => m === 'memory_peak' || m === 'memory_growth');
    const leaksRequested = input.metrics.includes('memory_leaks');
    const template = leaksRequested
      ? 'Leaks'
      : memoryRequested
        ? 'Activity Monitor'
        : 'Animation Hitches';
    const extraInstrument = leaksRequested
      ? 'Activity Monitor'
      : memoryRequested
        ? 'VM Tracker'
        : undefined;
    progress(
      `Starting ${template}${extraInstrument ? ` + ${extraInstrument}` : ''} performance recording…`,
    );
    let ready!: () => void;
    const readiness = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let outputTail = '';
    const recording = spawn(
      [
        'xcrun',
        'xctrace',
        'record',
        '--template',
        template,
        ...(extraInstrument ? ['--instrument', extraInstrument] : []),
        '--device',
        input.deviceId,
        '--attach',
        input.executable,
        '--output',
        trace,
        '--time-limit',
        '600s',
        '--no-prompt',
      ],
      {
        signal: input.signal,
        timeoutMs: 630_000,
        stopGraceMs: 30_000,
        onOutput: (chunk) => {
          outputTail = (outputTail + chunk).slice(-2048);
          if (/Recording started|(?:Hit )?Ctrl-C to stop(?: the recording)?/i.test(outputTail))
            ready();
        },
      },
    );
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    try {
      started = await Promise.race([
        readiness.then(() => true),
        recording.completed.then(() => false),
        new Promise<boolean>((resolve) => {
          readyTimer = setTimeout(() => resolve(false), 30_000);
        }),
      ]);
    } catch {
      recording.cancel();
      await recording.completed.catch(() => {});
      throw new Error('performance.recording_not_ready');
    } finally {
      clearTimeout(readyTimer);
    }
    if (!started || input.signal?.aborted) {
      recording.cancel();
      await recording.completed;
      throw new Error(
        input.signal?.aborted ? 'performance.cancelled' : 'performance.recording_not_ready',
      );
    }
    let endedEarly = false;
    const startedAt = performance.now();
    let finishing = false;
    void recording.completed
      .then(() => {
        if (!finishing) endedEarly = true;
      })
      .catch(() => {
        endedEarly = true;
      });
    let final: Promise<PerformanceCaptureResult> | undefined;
    return {
      finish() {
        final ??= (async () => {
          if (observation && !input.signal?.aborted && !endedEarly) {
            const waitMs = Math.max(
              observation.minimumDurationMs - (performance.now() - startedAt),
              observation.settleDurationMs,
            );
            const deadline = performance.now() + waitMs;
            try {
              while (performance.now() < deadline && !endedEarly) {
                progress(
                  `Observing memory after actions: ${Math.ceil((deadline - performance.now()) / 1000)}s remaining; recording is active…`,
                );
                await waitForObservation(
                  Math.min(1000, Math.max(0, deadline - performance.now())),
                  input.signal,
                );
              }
            } catch {
              recording.cancel();
              await recording.completed;
              return unavailable(input, 'performance.cancelled');
            }
          }
          finishing = true;
          const recordingDurationMs = performance.now() - startedAt;
          progress('Finalizing performance recording…');
          recording.stop();
          const recorded = await recording.completed;
          if (recorded.failure || recorded.exitCode !== 0 || endedEarly || !existsSync(trace)) {
            return unavailable(input, recorded.failure ?? 'performance.recording_incomplete');
          }
          const result: PerformanceCaptureResult = {
            metrics: {},
            artifacts: [
              {
                id: `${input.runId}-performance-trace`,
                type: 'trace',
                path: trace,
                backend: 'xctrace',
                redactionStatus: 'raw-local-only',
              },
            ],
          };
          progress('Exporting performance tables and checking requested metrics…');
          const run = async (args: string[]) =>
            spawn(['xcrun', 'xctrace', 'export', '--input', trace, ...args], {
              signal: input.signal,
              timeoutMs: 30_000,
            }).completed;
          try {
            const toc = await run(['--toc']);
            if (toc.failure || toc.exitCode !== 0) throw new Error('export_failed');
            // Only allow known metric schema names in an XPath. Never interpolate arbitrary XML.
            const schemas = [
              ...new Set(
                [...toc.stdout.matchAll(/<table\b[^>]*\bschema=["']([a-zA-Z0-9_.-]+)["']/g)]
                  .map((match) => match[1] as string)
                  .filter(
                    (name) =>
                      name === 'activity-monitor-process-live' ||
                      /memory|footprint|hitch|hang|fps|crash/i.test(name),
                  ),
              ),
            ].slice(0, 16);
            let parsed: PerformanceMetrics = {};
            if (leaksRequested) {
              progress('Checking exported Leaks diagnostics for the recorded target…');
              const leaks = await run([
                '--xpath',
                '/trace-toc/run[@number="1"]/tracks/track[@name="Leaks"]/details/detail[@name="Leaks"]',
              ]);
              if (leaks.failure || leaks.exitCode !== 0) throw new Error('export_failed');
              parsed.memoryLeaks = parseLeaksDetail(leaks.stdout);
            }
            for (const schema of schemas) {
              const exported = await run([
                '--xpath',
                `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`,
              ]);
              if (exported.failure || exported.exitCode !== 0) throw new Error('export_failed');
              const memory =
                schema === 'activity-monitor-process-live'
                  ? parseActivityMonitorMemory(exported.stdout, input.executable)
                  : undefined;
              const metrics =
                schema === 'activity-monitor-process-live'
                  ? memory
                    ? {
                        memoryPeakMB: memory.peakMiB,
                        memoryPeakUnit: 'MiB' as const,
                        ...(memory.growth ? { memoryGrowth: memory.growth } : {}),
                        approximate: true,
                      }
                    : {}
                  : parsePerformanceMetrics(exported.stdout, {
                      isSimulator: input.targetKind === 'simulator',
                    });
              if (metrics.memoryPeakMB !== undefined) parsed.memoryPeakUnit = undefined;
              for (const [key, value] of Object.entries(metrics)) {
                if (value !== undefined && value !== 'inconclusive')
                  parsed = { ...parsed, [key]: value };
              }
            }
            if (parsed.memoryGrowth) {
              parsed.memoryGrowth.recordingDurationMs = recordingDurationMs;
              parsed.memoryGrowth.coverage =
                observation && parsed.memoryGrowth.durationMs < observation.minimumDurationMs
                  ? 'partial'
                  : 'complete';
            }
            // Attach happens after launch. It cannot measure cold-launch latency or prove no crash.
            const collection: MetricCollectionOutcome[] = [];
            for (const metric of input.metrics) {
              const field = metric === 'xctrace_summary' ? undefined : FIELDS[metric];
              const value = field ? parsed[field] : undefined;
              const supported =
                metric !== 'launch_time' && metric !== 'xctrace_summary' && value !== undefined;
              const partialGrowth =
                metric === 'memory_growth' && parsed.memoryGrowth?.coverage === 'partial';
              collection.push({
                metric,
                status: supported && !partialGrowth ? 'collected' : 'not_exportable',
                reasonCode: partialGrowth
                  ? 'xctrace.memory_window_incomplete'
                  : supported
                    ? 'xctrace.observed_value'
                    : metric === 'launch_time'
                      ? 'xctrace.attach_after_launch'
                      : metric === 'memory_leaks'
                        ? 'xctrace.leaks_diagnostic_not_exportable'
                        : metric === 'memory_growth'
                          ? 'xctrace.memory_timestamps_insufficient'
                          : 'xctrace.schema_not_supported',
              });
              if (supported && field)
                result.metrics = { ...result.metrics, [field]: value, approximate: true };
              if (supported && metric === 'memory_peak' && parsed.memoryPeakUnit)
                result.metrics.memoryPeakUnit = parsed.memoryPeakUnit;
            }
            result.metrics.collection = collection;
          } catch {
            result.metrics.collection = unavailable(
              input,
              input.signal?.aborted ? 'performance.cancelled' : 'performance.export_failed',
            ).metrics.collection;
          }
          return result;
        })();
        return final;
      },
    };
  };
}
