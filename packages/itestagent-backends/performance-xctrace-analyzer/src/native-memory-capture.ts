import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  MEMORY_CAPTURE_POLICY,
  type MemoryGrowth,
  MemoryObservationSchema,
  type PerformanceCaptureFactory,
  type PerformanceCaptureResult,
  PerformanceCaptureStartError,
} from 'itestagent-contracts';
import { startCaptureProcess } from './capture-process.js';
import { analyzeMemoryGrowth } from './memory-growth.js';
import { parseNativeFootprint, parseNativeLeaks } from './native-memory-parsers.js';
import { waitForObservation } from './observation-wait.js';
import { bindSimulatorProcess } from './simulator-process-binding.js';

export interface NativeMemoryDependencies {
  spawn: typeof startCaptureProcess;
  now(): number;
  wallTime(): string;
  wait: typeof waitForObservation;
  realpath(path: string): string;
  uid(): number;
}

/** Simulator-only collector. One identity, bounded samples, one optional final scan. */
export function createNativeMemoryCapture(
  overrides: Partial<NativeMemoryDependencies> = {},
): PerformanceCaptureFactory {
  const deps: NativeMemoryDependencies = {
    spawn: startCaptureProcess,
    now: () => performance.now(),
    wallTime: () => new Date().toISOString(),
    wait: waitForObservation,
    realpath: realpathSync,
    uid: () => process.getuid?.() ?? -1,
    ...overrides,
  };
  return async (input) => {
    input.signal?.throwIfAborted();
    const dir = join(input.stagingDir, 'native-memory');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const auditPath = join(dir, 'evidence.jsonl');
    const artifactId = `${input.runId}-native-memory`;
    const artifacts: PerformanceCaptureResult['artifacts'] = [
      {
        id: artifactId,
        type: 'log',
        path: auditPath,
        backend: 'native-memory',
        redactionStatus: 'raw-local-only',
      },
    ];
    const audit = (v: unknown) =>
      appendFileSync(auditPath, `${JSON.stringify(v)}\n`, { mode: 0o600 });
    const controller = new AbortController();
    const signal = controller.signal;
    let failure: string | undefined;
    let finishing = false;
    let desiredEnd: number | undefined;
    let sampleLoop: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const samples: MemoryGrowth['samples'] = [];
    const requested = input.metrics.filter((m) => m !== 'test_duration');
    const memory = requested.some((m) => m === 'memory_peak' || m === 'memory_growth');
    const leaks = requested.includes('memory_leaks');
    const observation = MemoryObservationSchema.parse(
      input.memoryObservation ?? { minimumDurationMs: 70000, settleDurationMs: 10000 },
    );
    const notify = (message: string) => {
      try {
        input.onProgress?.(message);
      } catch {
        /* Observers do not own capture. */
      }
    };
    const stop = (reason: string) => {
      failure ??= reason;
      controller.abort();
    };
    const abort = () => stop('performance.cancelled');
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) abort();
    const fail = (error: unknown) =>
      stop(
        error instanceof Error && /^native_memory\.[a-z_]+$/.test(error.message)
          ? error.message
          : 'native_memory.capture_failed',
      );
    const cleanup = () => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
    };
    const unavailable = (): PerformanceCaptureResult => ({
      artifacts,
      metrics: {
        collection: requested.map((metric) => ({
          metric,
          status: failure === 'performance.cancelled' ? 'cancelled' : 'failed',
          reasonCode: failure ?? 'native_memory.capture_failed',
        })),
      },
    });
    const run = async (command: string[], timeoutMs = 10000) => {
      const start = deps.now();
      const startedAt = deps.wallTime();
      const result = await deps.spawn(command, { signal, timeoutMs }).completed;
      audit({
        command,
        startedAt,
        finishedAt: deps.wallTime(),
        measurementDurationMs: deps.now() - start,
        ...result,
      });
      return result;
    };
    const read = async (command: string[]) => {
      const result = await run(command);
      if (result.exitCode !== 0 || result.failure) throw new Error('native_memory.identity_failed');
      return result.stdout.trim();
    };
    let firstTime = 0;
    let check: () => Promise<void> = async () => {};
    audit({ source: 'native-memory', version: 1, startedAt: deps.wallTime() });
    try {
      if (
        input.targetKind !== 'simulator' ||
        !input.bundleId ||
        !/^[1-9]\d*$/.test(input.executable)
      )
        throw new Error('native_memory.invalid_target');
      const bindingInput = {
        simulatorId: input.deviceId,
        bundleId: input.bundleId,
        pid: Number(input.executable),
        run: read,
        realpath: deps.realpath,
        uid: deps.uid(),
      };
      notify('Binding the Simulator process for native memory capture…');
      timer = setTimeout(() => stop('native_memory.preparation_timeout'), 30000);
      const original = await bindSimulatorProcess(bindingInput);
      check = async () => {
        signal.throwIfAborted();
        const current = await bindSimulatorProcess(bindingInput);
        if (current.birth !== original.birth || current.executable !== original.executable)
          throw new Error('native_memory.process_changed');
      };
      const takeSample = async () => {
        await check();
        const path = join(dir, `sample-${samples.length}.json`);
        const started = deps.now();
        const result = await run([
          '/usr/bin/footprint',
          '-p',
          String(original.pid),
          '-f',
          'bytes',
          '--noCategories',
          '-j',
          path,
        ]);
        const completed = deps.now();
        if (result.exitCode !== 0 || result.failure) throw new Error('native_memory.sample_failed');
        const raw = readFileSync(path, 'utf8');
        audit({ snapshot: raw, sample: samples.length, completedAt: deps.wallTime() });
        const bytes = parseNativeFootprint(raw, original.pid);
        await check();
        if (
          completed < started ||
          (samples.length && completed <= (samples.at(-1)?.timestampMs ?? 0))
        )
          throw new Error('native_memory.invalid_sample_time');
        samples.push({
          timestampMs: completed,
          footprintMiB: bytes / 1048576,
          measurementDurationMs: completed - started,
        });
        notify(
          `Collecting native memory: ${samples.length} samples; ${Math.floor((completed - (samples[0]?.timestampMs ?? completed)) / 1000)}s observed…`,
        );
      };
      if (memory) {
        await takeSample();
        firstTime = samples[0]?.timestampMs ?? deps.now();
      }
      clearTimeout(timer);
      timer = setTimeout(() => stop('native_memory.capture_timeout'), 600000);
      if (memory) {
        sampleLoop = (async () => {
          while (samples.length < 300) {
            if (
              finishing &&
              desiredEnd !== undefined &&
              (samples.at(-1)?.timestampMs ?? 0) >= desiredEnd
            )
              return;
            await deps.wait(2000, signal);
            await takeSample();
          }
          throw new Error('native_memory.sample_limit');
        })().catch(fail);
      }
      let final: Promise<PerformanceCaptureResult> | undefined;
      return {
        signal,
        finish() {
          final ??= (async () => {
            finishing = true;
            desiredEnd = Math.max(
              firstTime + observation.minimumDurationMs + MEMORY_CAPTURE_POLICY.samplingAllowanceMs,
              deps.now() + observation.settleDurationMs,
            );
            try {
              await sampleLoop;
              clearTimeout(timer);
              if (failure || signal.aborted) return unavailable();
              const metrics: PerformanceCaptureResult['metrics'] = {};
              if (memory) {
                const growth = analyzeMemoryGrowth(samples, 'native-footprint');
                if (!growth || growth.durationMs < observation.minimumDurationMs)
                  throw new Error('native_memory.insufficient_coverage');
                growth.coverage = 'complete';
                if (requested.includes('memory_peak')) {
                  metrics.memoryPeakMB = growth.peakMiB;
                  metrics.memoryPeakUnit = 'MiB';
                  metrics.memoryPeakSource = 'native-footprint';
                }
                if (requested.includes('memory_growth')) metrics.memoryGrowth = growth;
                metrics.approximate = true;
              }
              if (leaks) {
                notify('Scanning the bound Simulator process for leaks…');
                await check();
                const startedAt = deps.wallTime();
                const scanned = await run(
                  ['/usr/bin/leaks', '--list', '--nostacks', '--noContent', String(original.pid)],
                  120000,
                );
                const finishedAt = deps.wallTime();
                await check();
                metrics.memoryLeaks = parseNativeLeaks({
                  ...scanned,
                  pid: original.pid,
                  startedAt,
                  finishedAt,
                  artifactId,
                });
              }
              metrics.collection = requested.map((metric) => ({
                metric,
                status: ['memory_peak', 'memory_growth', 'memory_leaks'].includes(metric)
                  ? 'collected'
                  : 'not_exportable',
                reasonCode: ['memory_peak', 'memory_growth', 'memory_leaks'].includes(metric)
                  ? 'native_memory.observed_value'
                  : 'native_memory.metric_unsupported',
              }));
              return { metrics, artifacts };
            } catch (error) {
              fail(error);
              return unavailable();
            } finally {
              cleanup();
            }
          })();
          return final;
        },
      };
    } catch (error) {
      fail(error);
      await sampleLoop;
      cleanup();
      throw new PerformanceCaptureStartError(unavailable());
    }
  };
}
