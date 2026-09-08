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
    const factory = createProductionPerformanceCapture((command, options) => {
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
    });
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
