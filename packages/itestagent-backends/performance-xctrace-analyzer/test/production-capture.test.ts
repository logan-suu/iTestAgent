import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PerformanceCaptureInput } from 'itestagent-contracts';
import { startCaptureProcess } from '../src/capture-process.js';
import { createProductionPerformanceCapture } from '../src/production-capture.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function input(): PerformanceCaptureInput {
  const stagingDir = mkdtempSync(join(tmpdir(), 'itestagent-perf-capture-'));
  roots.push(stagingDir);
  return {
    runId: 'perf-fixture',
    deviceId: 'FIXTURE',
    targetKind: 'physical',
    executable: 'Demo',
    stagingDir,
    metrics: ['memory_peak', 'launch_time', 'crash'],
  };
}

test('finalizes once before TOC/XPath exports; unknown data is not healthy data', async () => {
  const calls: string[][] = [];
  let stopped = 0;
  const factory = createProductionPerformanceCapture((command, options) => {
    calls.push(command);
    if (command.includes('record')) {
      mkdirSync(command[command.indexOf('--output') + 1] as string);
      let finish!: (value: {
        stdout: string;
        stderr: string;
        exitCode: number;
        failure: undefined;
      }) => void;
      const completed = new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
        failure: undefined;
      }>((resolve) => {
        finish = resolve;
      });
      queueMicrotask(() => {
        options.onOutput?.('Starting recording with the Activity Monitor template.\nCtrl-C to ');
        options.onOutput?.('stop the recording\n');
      });
      return {
        completed,
        cancel: () => {},
        stop: () => {
          stopped++;
          finish({ stdout: '', stderr: '', exitCode: 0, failure: undefined });
        },
      };
    }
    expect(stopped).toBe(1);
    return {
      completed: Promise.resolve({
        exitCode: 0,
        failure: undefined,
        stderr: '',
        stdout: command.includes('--toc')
          ? '<table schema="activity-monitor-process-live"/>'
          : `<trace-query-result><node><schema name="activity-monitor-process-live">
              <col><mnemonic>process</mnemonic><engineering-type>process</engineering-type></col>
              <col><mnemonic>pid</mnemonic><engineering-type>pid</engineering-type></col>
              <col><mnemonic>memory-physical-footprint</mnemonic><engineering-type>size-in-bytes</engineering-type></col>
              </schema><row><process id="1" fmt="Demo (321)"><pid id="2">321</pid></process>
              <pid ref="2"/><size-in-bytes id="3">44040192</size-in-bytes></row></node></trace-query-result>`,
      }),
      stop: () => {},
      cancel: () => {},
    };
  });
  const capture = await factory(input());
  const [first, second] = await Promise.all([capture.finish(), capture.finish()]);
  expect(first).toBe(second);
  expect(first.metrics.memoryPeakMB).toBe(42);
  expect(first.metrics.approximate).toBe(true);
  expect(first.metrics.crashDetected).toBeUndefined();
  expect(first.metrics.collection?.map((outcome) => outcome.status)).toEqual([
    'collected',
    'not_exportable',
    'not_exportable',
  ]);
  expect(first.artifacts[0]?.redactionStatus).toBe('raw-local-only');
  expect(calls).toHaveLength(3);
  expect(calls[0]).toContain('Demo');
  const recording = calls[0] as string[];
  expect(recording[recording.indexOf('--template') + 1]).toBe('Activity Monitor');
  expect(recording[recording.indexOf('--instrument') + 1]).toBe('VM Tracker');
});

test('non-memory recording keeps the Animation Hitches template without VM Tracker', async () => {
  const factory = createProductionPerformanceCapture((command) => {
    expect(command[command.indexOf('--template') + 1]).toBe('Animation Hitches');
    expect(command).not.toContain('--instrument');
    return {
      completed: Promise.resolve({ exitCode: 1, stdout: '', stderr: '', failure: undefined }),
      stop: () => {},
      cancel: () => {},
    };
  });
  await expect(factory({ ...input(), metrics: ['hitches'] })).rejects.toThrow(
    'performance.recording_not_ready',
  );
});

test('recording early exit rejects without exporting or pretending readiness', async () => {
  let cancelled = false;
  const factory = createProductionPerformanceCapture(() => ({
    completed: Promise.resolve({
      exitCode: 1,
      stdout: '',
      stderr: 'private diagnostic',
      failure: undefined,
    }),
    stop: () => {},
    cancel: () => {
      cancelled = true;
    },
  }));
  await expect(factory(input())).rejects.toThrow('performance.recording_not_ready');
  expect(cancelled).toBe(true);
});

for (const cancelled of [false, true]) {
  test(`export failure preserves finalized raw evidence (cancelled=${cancelled})`, async () => {
    const controller = new AbortController();
    const args = {
      ...input(),
      signal: controller.signal,
      onProgress: () => {
        throw new Error('observer failed');
      },
    };
    const factory = createProductionPerformanceCapture((command, options) => {
      if (command.includes('record')) {
        mkdirSync(command[command.indexOf('--output') + 1] as string);
        let finish!: (value: {
          stdout: string;
          stderr: string;
          exitCode: number;
          failure: undefined;
        }) => void;
        const completed = new Promise<{
          stdout: string;
          stderr: string;
          exitCode: number;
          failure: undefined;
        }>((resolve) => {
          finish = resolve;
        });
        queueMicrotask(() => options.onOutput?.('Recording started'));
        return {
          completed,
          cancel: () => {},
          stop: () => finish({ stdout: '', stderr: '', exitCode: 0, failure: undefined }),
        };
      }
      if (cancelled) controller.abort();
      return {
        completed: Promise.resolve({
          stdout: '',
          stderr: 'private export details',
          exitCode: 1,
          failure: undefined,
        }),
        stop: () => {},
        cancel: () => {},
      };
    });
    const capture = await factory(args);
    const result = await capture.finish();
    expect(result.artifacts).toHaveLength(1);
    expect(
      result.metrics.collection?.every(
        (outcome) => outcome.status === (cancelled ? 'cancelled' : 'failed'),
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private export details');
    expect(result.metrics.memoryPeakMB).toBeUndefined();
  });
}

test('transport rejection clears readiness and completes teardown without an unhandled rejection', async () => {
  let cancelled = false;
  const factory = createProductionPerformanceCapture(() => ({
    completed: Promise.reject(new Error('performance.transport_failed')),
    stop: () => {},
    cancel: () => {
      cancelled = true;
    },
  }));
  await expect(factory(input())).rejects.toThrow('performance.recording_not_ready');
  expect(cancelled).toBe(true);
});

test('real owned child is terminated and reaped on cancellation', async () => {
  const controller = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const child = startCaptureProcess(
    [process.execPath, '-e', 'console.log("ready");setInterval(()=>{},1000)'],
    {
      timeoutMs: 5_000,
      signal: controller.signal,
      onOutput: () => ready(),
    },
  );
  await started;
  controller.abort();
  expect((await child.completed).failure).toBe('performance.cancelled');
});

test('real owned child has a bounded deadline', async () => {
  const child = startCaptureProcess([process.execPath, '-e', 'setInterval(()=>{},1000)'], {
    timeoutMs: 30,
  });
  expect((await child.completed).failure).toBe('performance.process_timeout');
});
