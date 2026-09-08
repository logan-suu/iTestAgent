import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductionPerformanceCapture } from '../src/production-capture.js';

const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});
const xml = `<trace-query-result><node><schema name="activity-monitor-process-live">
<col><mnemonic>process</mnemonic><engineering-type>process</engineering-type></col>
<col><mnemonic>pid</mnemonic><engineering-type>pid</engineering-type></col>
<col><mnemonic>memory-physical-footprint</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
<col><mnemonic>start</mnemonic><engineering-type>start-time</engineering-type></col></schema>
<row><process id="1" fmt="Demo (321)"><pid id="2">321</pid></process><pid ref="2"/><size-in-bytes id="3">1048576</size-in-bytes><start-time id="4">0</start-time></row>
<row><process ref="1"/><pid ref="2"/><size-in-bytes id="5">2097152</size-in-bytes><start-time id="6">1000000000</start-time></row>
</node></trace-query-result>`;

test('production exports Leaks track details even when no data/table schema advertises them', async () => {
  const stagingDir = mkdtempSync(join(tmpdir(), 'itestagent-leaks-production-'));
  roots.push(stagingDir);
  const queries: string[] = [];
  const factory = createProductionPerformanceCapture((command, options) => {
    const ok = { stdout: '', stderr: '', exitCode: 0, failure: undefined };
    if (command.includes('record')) {
      mkdirSync(command[command.indexOf('--output') + 1] as string);
      let done!: (r: typeof ok) => void;
      const completed = new Promise<typeof ok>((resolve) => {
        done = resolve;
      });
      queueMicrotask(() => options.onOutput?.('Ctrl-C to stop the recording'));
      return { completed, stop: () => done(ok), cancel: () => done(ok) };
    }
    const xpath = command[command.indexOf('--xpath') + 1];
    if (command.includes('--xpath')) queries.push(xpath as string);
    return {
      completed: Promise.resolve({
        ...ok,
        stdout: command.includes('--toc')
          ? '<trace-toc/>'
          : '<trace-query-result><node><row leaked-object="Fixture" size="262144" count="1" address="0x1000"/></node></trace-query-result>',
      }),
      stop() {},
      cancel() {},
    };
  });
  const capture = await factory({
    runId: 'leaks',
    deviceId: 'fixture',
    targetKind: 'physical',
    executable: 'Demo',
    stagingDir,
    metrics: ['memory_leaks'],
  });
  const result = await capture.finish();
  expect(queries).toEqual([
    '/trace-toc/run[@number="1"]/tracks/track[@name="Leaks"]/details/detail[@name="Leaks"]',
  ]);
  expect(result.metrics.memoryLeaks?.allocationCount).toBe(1);
  expect(result.metrics.collection?.[0]?.status).toBe('collected');
  expect(result.artifacts[0]?.redactionStatus).toBe('raw-local-only');
});

for (const abort of [false, true])
  test(`production Leaks capture preserves growth facts or cancels observation (abort=${abort})`, async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'itestagent-memory-production-'));
    roots.push(stagingDir);
    const calls: string[][] = [];
    const controller = new AbortController();
    let cancellations = 0;
    let now = 0;
    const factory = createProductionPerformanceCapture(
      (command, options) => {
        calls.push(command);
        const ok = { stdout: '', stderr: '', exitCode: 0, failure: undefined };
        if (command.includes('record')) {
          expect(command[command.indexOf('--template') + 1]).toBe('Leaks');
          expect(command[command.indexOf('--instrument') + 1]).toBe('Activity Monitor');
          mkdirSync(command[command.indexOf('--output') + 1] as string);
          let done!: (r: typeof ok) => void;
          const completed = new Promise<typeof ok>((resolve) => {
            done = resolve;
          });
          queueMicrotask(() => options.onOutput?.('Ctrl-C to stop the recording'));
          return {
            completed,
            stop: () => done(ok),
            cancel: () => {
              cancellations++;
              done(ok);
            },
          };
        }
        return {
          completed: Promise.resolve({
            ...ok,
            stdout: command.includes('--toc')
              ? '<table schema="activity-monitor-process-live"/>'
              : xml,
          }),
          stop() {},
          cancel() {},
        };
      },
      {
        now: () => now,
        wait: async (ms, signal) => {
          signal?.throwIfAborted();
          now += ms;
        },
      },
    );
    const messages: string[] = [];
    const capture = await factory({
      runId: 'fixture',
      deviceId: 'fixture',
      targetKind: 'physical',
      executable: 'Demo',
      stagingDir,
      metrics: ['memory_peak', 'memory_growth', 'memory_leaks'],
      memoryObservation: { minimumDurationMs: 1000, settleDurationMs: 0 },
      signal: controller.signal,
      onProgress: (m) => {
        messages.push(m);
        if (abort && m.startsWith('Observing')) controller.abort();
      },
    });
    const [result, again] = await Promise.all([capture.finish(), capture.finish()]);
    expect(result).toBe(again);
    expect(messages.some((m) => m.startsWith('Observing memory'))).toBe(true);
    if (abort) {
      expect(calls).toHaveLength(1);
      expect(cancellations).toBe(1);
      expect(result.metrics.collection?.every((o) => o.status === 'cancelled')).toBe(true);
    } else {
      expect(result.metrics.memoryGrowth?.deltaMiB).toBe(1);
      expect(result.metrics.memoryGrowth?.recordingDurationMs).toBe(31_000);
      expect(result.metrics.memoryPeakUnit).toBe('MiB');
      expect(result.metrics.collection).toEqual([
        { metric: 'memory_peak', status: 'collected', reasonCode: 'xctrace.observed_value' },
        { metric: 'memory_growth', status: 'collected', reasonCode: 'xctrace.observed_value' },
        {
          metric: 'memory_leaks',
          status: 'not_exportable',
          reasonCode: 'xctrace.leaks_diagnostic_not_exportable',
        },
      ]);
      expect(result.artifacts[0]?.redactionStatus).toBe('raw-local-only');
    }
  });

for (const scenario of [
  {
    name: 'delayed samples cover the requested window',
    elapsed: 20_000,
    span: 85_000,
    stopAt: 100_000,
    complete: true,
  },
  {
    name: 'allowance does not promote short samples',
    elapsed: 20_000,
    span: 59_847,
    stopAt: 100_000,
    complete: false,
  },
  {
    name: 'long actions do not add another allowance',
    elapsed: 150_000,
    span: 140_000,
    stopAt: 160_000,
    complete: true,
  },
  {
    name: 'zero settling preserves completed recording budget',
    elapsed: 150_000,
    span: 140_000,
    stopAt: 150_000,
    complete: true,
    settle: 0,
  },
  {
    name: 'maximum observation remains below the transport limit',
    elapsed: 0,
    span: 300_000,
    stopAt: 330_000,
    complete: true,
    minimum: 300_000,
    settle: 60_000,
  },
  {
    name: 'cancellation during allowance stops without export',
    elapsed: 20_000,
    span: 85_000,
    stopAt: 71_000,
    complete: false,
    abortAt: 71_000,
  },
  {
    name: 'early process exit during allowance stays failed',
    elapsed: 20_000,
    span: 85_000,
    stopAt: 71_000,
    complete: false,
    exitAt: 71_000,
  },
]) {
  test(`sampling budget: ${scenario.name}`, async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'itestagent-sampling-budget-'));
    roots.push(stagingDir);
    const controller = new AbortController();
    let now = 0;
    let stopAt = -1;
    let stops = 0;
    let cancels = 0;
    let exports = 0;
    let records = 0;
    const ok = { stdout: '', stderr: '', exitCode: 0, failure: undefined };
    let resolveRecording!: (result: typeof ok) => void;
    const messages: string[] = [];
    const factory = createProductionPerformanceCapture(
      (command, options) => {
        if (command.includes('record')) {
          records++;
          expect(command[command.indexOf('--time-limit') + 1]).toBe('600s');
          mkdirSync(command[command.indexOf('--output') + 1] as string);
          const completed = new Promise<typeof ok>((resolve) => {
            resolveRecording = resolve;
          });
          queueMicrotask(() => options.onOutput?.('Recording started'));
          return {
            completed,
            stop: () => {
              stops++;
              stopAt = now;
              resolveRecording(ok);
            },
            cancel: () => {
              cancels++;
              stopAt = now;
              resolveRecording(ok);
            },
          };
        }
        exports++;
        expect(stops).toBe(1);
        return {
          completed: Promise.resolve({
            ...ok,
            stdout: command.includes('--toc')
              ? '<table schema="activity-monitor-process-live"/>'
              : xml.replace('>1000000000<', `>${scenario.span * 1_000_000}<`),
          }),
          stop() {},
          cancel() {},
        };
      },
      {
        now: () => now,
        wait: async (ms, signal) => {
          expect(ms).toBeLessThanOrEqual(1000);
          now += ms;
          if (scenario.abortAt && now >= scenario.abortAt) controller.abort();
          if (scenario.exitAt && now >= scenario.exitAt) {
            resolveRecording(ok);
            await Promise.resolve();
          }
          signal?.throwIfAborted();
        },
      },
    );
    const capture = await factory({
      runId: 'sampling-fixture',
      deviceId: 'fixture',
      targetKind: 'physical',
      executable: 'Demo',
      stagingDir,
      metrics: ['memory_growth'],
      signal: controller.signal,
      memoryObservation: {
        minimumDurationMs: scenario.minimum ?? 70_000,
        settleDurationMs: scenario.settle ?? 10_000,
      },
      onProgress: (m) => messages.push(m),
    });
    now = scenario.elapsed;
    const [result, again] = await Promise.all([capture.finish(), capture.finish()]);
    expect(result).toBe(again);
    expect(records).toBe(1);
    expect(stopAt).toBe(scenario.stopAt);
    if (scenario.abortAt || scenario.exitAt) {
      expect(exports).toBe(0);
      expect(cancels).toBe(scenario.abortAt ? 1 : 0);
      expect(result.metrics.collection?.[0]?.status).toBe(
        scenario.abortAt ? 'cancelled' : 'failed',
      );
      expect(result.metrics.memoryGrowth).toBeUndefined();
    } else {
      expect(stops).toBe(1);
      expect(exports).toBe(2);
      expect(result.metrics.memoryGrowth?.durationMs).toBe(scenario.span);
      expect(result.metrics.memoryGrowth?.recordingDurationMs).toBe(scenario.stopAt);
      expect(result.metrics.memoryGrowth?.coverage).toBe(
        scenario.complete ? 'complete' : 'partial',
      );
      expect(result.metrics.collection?.[0]?.status).toBe(
        scenario.complete ? 'collected' : 'not_exportable',
      );
      if (!scenario.complete)
        expect(result.metrics.collection?.[0]?.reasonCode).toBe('xctrace.memory_window_incomplete');
    }
    if (scenario.elapsed < scenario.stopAt) {
      expect(messages.some((m) => m.includes('sampling allowance (30s)'))).toBe(true);
      expect(messages.some((m) => m.includes('coverage is verified after export'))).toBe(true);
    }
  });
}
