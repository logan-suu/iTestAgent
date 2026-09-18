import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryLeaksSchema, PerformanceCaptureStartError } from 'itestagent-contracts';
import { startCaptureProcess } from '../src/capture-process.js';
import { createNativeMemoryCapture } from '../src/native-memory-capture.js';
import { parseNativeFootprint, parseNativeLeaks } from '../src/native-memory-parsers.js';

const snapshot = (pid = 321, bytes = 1048576) =>
  JSON.stringify({
    unit: 'byte',
    'bytes per unit': 1,
    processes: [{ pid, footprint: bytes, auxiliary: { phys_footprint_peak: 999999999 } }],
    errors: [],
    warnings: [],
    'total footprint': bytes,
  });
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function harness(
  options: {
    wrongPid?: boolean;
    birthChanges?: boolean;
    uid?: number;
    scan?: string;
    scanExit?: number;
    sampleFailure?: boolean;
    ownedChild?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'itestagent-native-memory-'));
  roots.push(root);
  let time = 0;
  let snapshots = 0;
  let births = 0;
  const commands: string[][] = [];
  let ownedCompleted: ReturnType<typeof startCaptureProcess>['completed'] | undefined;
  let started: () => void = () => {};
  const ownedStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const spawn: typeof startCaptureProcess = (command, opts) => {
    opts.signal?.throwIfAborted();
    commands.push(command);
    time += 1;
    if (options.ownedChild && command[0] === '/usr/bin/footprint') {
      const child = startCaptureProcess(
        [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        opts,
      );
      ownedCompleted = child.completed;
      started();
      return child;
    }
    let stdout = '';
    let exitCode = 0;
    if (command.includes('launchctl')) stdout = '321 0 UIKitApplication:com.example.fixture[one]';
    else if (command.includes('get_app_container')) stdout = '/fixture/App.app';
    else if (command[0] === '/usr/libexec/PlistBuddy') stdout = 'Fixture';
    else if (command.includes('comm=')) stdout = '/fixture/App.app/Fixture';
    else if (command.includes('lstart='))
      stdout = options.birthChanges && births++ > 0 ? 'second birth' : 'first birth';
    else if (command.includes('uid=')) stdout = String(options.uid ?? 501);
    else if (command[0] === '/usr/bin/footprint') {
      if (options.sampleFailure && snapshots > 0) exitCode = 1;
      else
        writeFileSync(
          command[command.indexOf('-j') + 1] ??
            (() => {
              throw new Error('Missing snapshot path');
            })(),
          snapshot(options.wrongPid ? 999 : 321, 1048576 + snapshots * 4096),
        );
      snapshots++;
    } else if (command[0] === '/usr/bin/leaks') {
      stdout = options.scan ?? 'Process 321: 0 leaks for 0 total leaked bytes';
      exitCode = options.scanExit ?? 0;
    } else throw new Error('unexpected_fixture_command');
    return {
      completed: Promise.resolve({ stdout, stderr: '', exitCode, failure: undefined }),
      stop() {},
      cancel() {},
    };
  };
  const factory = createNativeMemoryCapture({
    spawn,
    now: () => time,
    wallTime: () => new Date(Date.UTC(2026, 8, 9) + time).toISOString(),
    wait: async (ms, signal) => {
      signal?.throwIfAborted();
      time += ms;
    },
    realpath: (path) => path,
    uid: () => 501,
  });
  const input = {
    runId: 'native-test',
    deviceId: 'simulator-fixture',
    targetKind: 'simulator' as const,
    bundleId: 'com.example.fixture',
    executable: '321',
    stagingDir: root,
    metrics: ['memory_peak', 'memory_growth', 'memory_leaks'] as const,
    memoryObservation: { minimumDurationMs: 70000, settleDurationMs: 10000 },
  };
  return {
    factory,
    input: { ...input, metrics: [...input.metrics] },
    commands,
    ownedStarted,
    getOwnedCompletion: () => ownedCompleted,
  };
}

describe('native memory facts', () => {
  test('uses current byte footprint rather than the auxiliary lifetime peak', () =>
    expect(parseNativeFootprint(snapshot(), 321)).toBe(1048576));
  test('rejects missing units, wrong PID, multiple targets and tool warnings', () => {
    expect(() => parseNativeFootprint('{', 321)).toThrow();
    expect(() => parseNativeFootprint(snapshot(999), 321)).toThrow();
    for (const update of [
      { unit: 'pages' },
      { 'bytes per unit': 4096 },
      { processes: [] },
      { warnings: ['fixture'] },
      { errors: ['fixture'] },
    ])
      expect(() =>
        parseNativeFootprint(JSON.stringify({ ...JSON.parse(snapshot()), ...update }), 321),
      ).toThrow();
  });
  test('requires a unique matching completion and consistent exit/counts', () => {
    const base = {
      stdout: 'Process 321: 0 leaks for 0 total leaked bytes',
      exitCode: 0,
      pid: 321,
      startedAt: '2026-09-09T00:00:00Z',
      finishedAt: '2026-09-09T00:00:01Z',
      artifactId: 'audit',
    };
    expect(parseNativeLeaks(base).status).toBe('not_detected');
    expect(
      parseNativeLeaks({
        ...base,
        stdout: 'Process 321: 17 leaks for 4456448 total leaked bytes',
        exitCode: 1,
      }).status,
    ).toBe('detected');
    for (const update of [
      { stdout: '' },
      { stdout: 'Process 999: 0 leaks for 0 total leaked bytes' },
      { exitCode: 1 },
      { failure: 'performance.process_timeout' },
      { stdout: `${base.stdout}\n${base.stdout}` },
      { finishedAt: '2026-09-08T00:00:00Z' },
    ])
      expect(() => parseNativeLeaks({ ...base, ...update })).toThrow();
    expect(
      MemoryLeaksSchema.safeParse({
        source: 'xctrace-leaks-detail',
        status: 'not_detected',
        scope: 'observed_allocations',
        allocationCount: 0,
        totalBytes: 0,
      }).success,
    ).toBe(false);
  });
  test('captures valid samples and one zero scan, finishes idempotently', async () => {
    const { factory, input, commands } = harness();
    const capture = await factory(input);
    const first = capture.finish();
    expect(capture.finish()).toBe(first);
    const result = await first;
    expect(result.metrics.memoryGrowth?.source).toBe('native-footprint');
    expect(result.metrics.memoryGrowth?.durationMs).toBeGreaterThanOrEqual(70000);
    expect(
      result.metrics.memoryGrowth?.samples.every((s) => s.measurementDurationMs !== undefined),
    ).toBe(true);
    expect(result.metrics.memoryPeakSource).toBe('native-footprint');
    expect(result.metrics.memoryLeaks?.status).toBe('not_detected');
    expect(commands.filter((c) => c[0] === '/usr/bin/leaks')).toHaveLength(1);
    expect(commands.some((c) => c.includes('xctrace'))).toBe(false);
    expect(result.artifacts[0]?.redactionStatus).toBe('raw-local-only');
  });
  test('leaks-only does not fabricate footprint metrics or run a sampler', async () => {
    const { factory, input, commands } = harness({
      scan: 'Process 321: 17 leaks for 4456448 total leaked bytes',
      scanExit: 1,
    });
    const result = await (await factory({ ...input, metrics: ['memory_leaks'] })).finish();
    expect(result.metrics.memoryLeaks?.status).toBe('detected');
    expect(result.metrics.memoryGrowth).toBeUndefined();
    expect(commands.some((c) => c[0] === '/usr/bin/footprint')).toBe(false);
  });
  test('preparation failures carry an audit and never scan leaks', async () => {
    for (const options of [{ wrongPid: true }, { birthChanges: true }, { uid: 999 }]) {
      const { factory, input, commands } = harness(options);
      try {
        await factory(input);
        throw new Error('unexpected_success');
      } catch (error) {
        expect(error).toBeInstanceOf(PerformanceCaptureStartError);
        expect((error as PerformanceCaptureStartError).result.artifacts).toHaveLength(1);
      }
      expect(commands.some((c) => c[0] === '/usr/bin/leaks')).toBe(false);
    }
  });
  test('a failed sample aborts dependent actions and cannot become a zero scan', async () => {
    const { factory, input, commands } = harness({ sampleFailure: true });
    const capture = await factory(input);
    const result = await capture.finish();
    expect(capture.signal?.aborted).toBe(true);
    expect(result.metrics.memoryLeaks).toBeUndefined();
    expect(result.metrics.collection?.every((m) => m.status === 'failed')).toBe(true);
    expect(commands.some((c) => c[0] === '/usr/bin/leaks')).toBe(false);
  });
  test('cancelling preparation waits for the actual owned sampling child to exit', async () => {
    const h = harness({ ownedChild: true });
    const abort = new AbortController();
    const pending = h.factory({ ...h.input, signal: abort.signal });
    await h.ownedStarted;
    abort.abort();
    await expect(pending).rejects.toBeInstanceOf(PerformanceCaptureStartError);
    const result = await h.getOwnedCompletion();
    expect(result?.failure).toBe('performance.cancelled');
    expect(h.commands.some((command) => command[0] === '/usr/bin/leaks')).toBe(false);
  });
  test('external cancellation returns cancelled facts and skips diagnostic scan', async () => {
    const { factory, input, commands } = harness();
    const abort = new AbortController();
    const capture = await factory({ ...input, signal: abort.signal });
    abort.abort();
    const result = await capture.finish();
    expect(result.metrics.collection?.every((m) => m.status === 'cancelled')).toBe(true);
    expect(commands.some((c) => c[0] === '/usr/bin/leaks')).toBe(false);
  });
});
