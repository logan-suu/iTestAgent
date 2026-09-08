import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  MetricCollectionOutcome,
  PerformanceCaptureFactory,
  PerformanceCaptureInput,
  PerformanceCaptureResult,
  PerformanceMetrics,
} from 'itestagent-contracts';
import { startCaptureProcess } from './capture-process.js';
import { parsePerformanceMetrics } from './metrics-parser.js';

const FIELDS = {
  launch_time: 'launchDurationMs',
  memory_peak: 'memoryPeakMB',
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
    const template = input.metrics.includes('memory_peak') ? 'VM Tracker' : 'Animation Hitches';
    progress(`Starting ${template} performance recording…`);
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
          if (/Recording started|Hit Ctrl-C to stop/i.test(outputTail)) ready();
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
          finishing = true;
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
                  .filter((name) => /memory|footprint|hitch|hang|fps|crash/i.test(name)),
              ),
            ].slice(0, 16);
            let parsed: PerformanceMetrics = {};
            for (const schema of schemas) {
              const exported = await run([
                '--xpath',
                `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`,
              ]);
              if (exported.failure || exported.exitCode !== 0) throw new Error('export_failed');
              const metrics = parsePerformanceMetrics(exported.stdout, {
                isSimulator: input.targetKind === 'simulator',
              });
              for (const [key, value] of Object.entries(metrics)) {
                if (value !== undefined && value !== 'inconclusive')
                  parsed = { ...parsed, [key]: value };
              }
            }
            // Attach happens after launch. It cannot measure cold-launch latency or prove no crash.
            const collection: MetricCollectionOutcome[] = [];
            for (const metric of input.metrics) {
              const field = metric === 'xctrace_summary' ? undefined : FIELDS[metric];
              const value = field ? parsed[field] : undefined;
              const supported =
                metric !== 'launch_time' && metric !== 'xctrace_summary' && value !== undefined;
              collection.push({
                metric,
                status: supported ? 'collected' : 'not_exportable',
                reasonCode: supported
                  ? 'xctrace.observed_value'
                  : metric === 'launch_time'
                    ? 'xctrace.attach_after_launch'
                    : 'xctrace.schema_not_supported',
              });
              if (supported && field)
                result.metrics = { ...result.metrics, [field]: value, approximate: true };
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
