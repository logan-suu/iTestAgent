import { expect, test } from 'bun:test';
import { startCaptureProcess } from '../src/capture-process.js';
import { startReadyRecording } from '../src/capture-readiness.js';

const ok = { stdout: '', stderr: '', exitCode: 0, failure: undefined };
function fixture(mode: string) {
  let subscriberDone!: (value: typeof ok) => void;
  let recorderDone!: (value: typeof ok) => void;
  let key = '';
  let probe = '';
  let recordCount = 0;
  let closed = 0;
  const spawn: typeof startCaptureProcess = (args, options) => {
    const subscriber = args[0] === '/usr/bin/notifyutil';
    const completed = new Promise<typeof ok>((resolve) => {
      if (subscriber) subscriberDone = resolve;
      else recorderDone = resolve;
    });
    if (subscriber) {
      key = args[2] as string;
      probe = args[4] as string;
      expect(args).toEqual(['/usr/bin/notifyutil', '-1', key, '-1', probe, '-p', probe]);
      expect(key).not.toBe(probe);
      queueMicrotask(() => {
        if (mode === 'registration_failure')
          subscriberDone({ ...ok, stdout: `${probe}: Failed with code 9` });
        else if (mode !== 'no_registration') {
          options.onOutput?.(probe.slice(0, 8));
          options.onOutput?.(`${probe.slice(8)}\n`);
        }
      });
    } else {
      recordCount++;
      expect(args.at(-1)).toBe(key);
      queueMicrotask(() => {
        options.onOutput?.('Ctrl-C to stop the recording\nRecording started\n');
        if (mode === 'hint_then_exit') recorderDone({ ...ok, exitCode: 2 });
        else if (mode === 'error') options.onOutput?.('[Error] fixture failure');
        else if (mode !== 'no_notification') {
          subscriberDone({
            ...ok,
            stdout: `${probe}\n${mode === 'wrong_notification' ? 'foreign.started' : key}\n`,
          });
          if (mode === 'concurrent_exit') recorderDone(ok);
        }
      });
    }
    return {
      completed,
      stop: () => {
        closed++;
        (subscriber ? subscriberDone : recorderDone)(ok);
      },
      cancel: () => {
        closed++;
        (subscriber ? subscriberDone : recorderDone)({ ...ok, exitCode: 143 });
      },
    };
  };
  return {
    spawn,
    exit: () => recorderDone({ ...ok, exitCode: 2 }),
    counts: () => ({ recordCount, closed }),
  };
}
for (const mode of [
  'registration_failure',
  'no_registration',
  'hint_then_exit',
  'no_notification',
  'wrong_notification',
  'concurrent_exit',
  'error',
]) {
  test(`readiness blocks and cleans owned children: ${mode}`, async () => {
    const f = fixture(mode);
    await expect(
      startReadyRecording(f.spawn, ['fixture-record'], { timeoutMs: 40 }),
    ).rejects.toThrow();
    expect(f.counts().recordCount).toBe(
      mode === 'registration_failure' || mode === 'no_registration' ? 0 : 1,
    );
    expect(f.counts().closed).toBeGreaterThan(0);
  });
}

test('verified notification allows capture; later exit aborts dependent work', async () => {
  const f = fixture('success');
  const capture = await startReadyRecording(f.spawn, ['fixture-record'], {});
  expect(capture.signal.aborted).toBe(false);
  f.exit();
  await capture.completed;
  await Promise.resolve();
  expect(capture.signal.aborted).toBe(true);
  expect(capture.failure()).toBe('performance.recording_incomplete');
});

test('normal stop is distinct from early exit', async () => {
  const f = fixture('success');
  const capture = await startReadyRecording(f.spawn, ['fixture-record'], {});
  capture.stop();
  await capture.completed;
  expect(capture.signal.aborted).toBe(false);
  expect(capture.failure()).toBeUndefined();
});

test('abort during registration reaps subscriber and never starts recording', async () => {
  const f = fixture('no_registration');
  const controller = new AbortController();
  const pending = startReadyRecording(f.spawn, ['fixture-record'], { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('performance.cancelled');
  expect(f.counts()).toEqual({ recordCount: 0, closed: 1 });
});

// This exercises only public host notifications and an owned Bun child, never a device.
test.skipIf(process.platform !== 'darwin')(
  'public notification handshake and cancellation reap real owned children',
  async () => {
    const children: ReturnType<typeof startCaptureProcess>[] = [];
    const spawn: typeof startCaptureProcess = (args, options) => {
      const command =
        args[0] === 'fixture-record'
          ? [
              process.execPath,
              '-e',
              `Bun.spawnSync(['/usr/bin/notifyutil','-p',${JSON.stringify(args.at(-1))}]);setInterval(()=>{},1000)`,
            ]
          : args;
      const child = startCaptureProcess(command, options);
      children.push(child);
      return child;
    };
    const controller = new AbortController();
    try {
      const capture = await startReadyRecording(spawn, ['fixture-record'], {
        signal: controller.signal,
        timeoutMs: 3000,
      });
      expect(capture.signal.aborted).toBe(false);
      controller.abort();
      await capture.completed;
      expect(capture.signal.aborted).toBe(true);
    } finally {
      for (const child of children) child.cancel();
      await Promise.allSettled(children.map((child) => child.completed));
    }
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.isRunning?.() === false)).toBe(true);
  },
);

test('output transport rejection is observed even when exit is monitored separately', async () => {
  const f = fixture('success');
  let rejectOutput!: (error: Error) => void;
  const spawn: typeof startCaptureProcess = (args, options) => {
    const child = f.spawn(args, options);
    if (args[0] !== 'fixture-record') return child;
    return {
      ...child,
      exited: new Promise<number>(() => {}),
      completed: new Promise((_, reject) => {
        rejectOutput = reject;
      }),
    };
  };
  const capture = await startReadyRecording(spawn, ['fixture-record'], {});
  rejectOutput(new Error('private transport fixture'));
  await expect(capture.completed).rejects.toThrow();
  expect(capture.signal.aborted).toBe(true);
  expect(capture.failure()).toBe('performance.transport_failed');
});
