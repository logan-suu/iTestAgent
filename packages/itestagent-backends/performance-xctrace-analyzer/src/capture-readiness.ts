import { randomUUID } from 'node:crypto';
import type { startCaptureProcess } from './capture-process.js';

/** Two registrations in one process; the probe is never the recording-start event. */
export async function startReadyRecording(
  spawn: typeof startCaptureProcess,
  command: string[],
  options: { signal?: AbortSignal; timeoutMs?: number },
) {
  const owner = `com.itestagent.capture.${randomUUID()}`;
  const key = `${owner}.started`;
  const probe = `${owner}.registered`;
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let reason: string | undefined;
  let stopping = false;
  let ended = false;
  let recording: ReturnType<typeof startCaptureProcess> | undefined;
  let subscriber: ReturnType<typeof startCaptureProcess> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let registered!: () => void;
  const registration = new Promise<void>((resolve) => {
    registered = resolve;
  });
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  // A failure can arrive while the caller is running business actions.
  void failure.catch(() => {});
  const fail = (code: string) => {
    reason ??= code;
    rejectFailure(new Error(reason));
    controller.abort();
  };
  const aborted = () => fail('performance.cancelled');
  options.signal?.addEventListener('abort', aborted, { once: true });
  const detach = () => options.signal?.removeEventListener('abort', aborted);
  let lines = '';
  let tail = '';
  try {
    signal.throwIfAborted();
    timer = setTimeout(() => fail('performance.recording_not_ready'), options.timeoutMs ?? 30_000);
    subscriber = spawn(['/usr/bin/notifyutil', '-1', key, '-1', probe, '-p', probe], {
      signal,
      timeoutMs: options.timeoutMs ?? 30_000,
      onOutput: (chunk) => {
        lines += chunk;
        if (lines.split(/\r?\n/).includes(probe)) registered();
      },
    });
    const notified = subscriber.completed.then((result) => {
      const received = result.stdout.trim().split(/\r?\n/);
      if (
        result.failure ||
        result.exitCode !== 0 ||
        result.stderr.trim() ||
        received.length !== 2 ||
        received[0] !== probe ||
        received[1] !== key ||
        !recording
      )
        throw new Error('performance.notification_failed');
    });
    void notified.catch(() => fail('performance.notification_failed'));
    await Promise.race([registration, failure]);
    signal.throwIfAborted();
    if (subscriber.isRunning?.() === false) throw new Error('performance.notification_failed');
    recording = spawn([...command, '--notify-tracing-started', key], {
      signal,
      timeoutMs: 630_000,
      stopGraceMs: 30_000,
      onOutput: (chunk) => {
        tail = (tail + chunk).slice(-2048);
        if (/Recording failed|\[Error\]/i.test(tail)) fail('performance.recording_failed');
      },
    });
    void (recording.exited ?? recording.completed).then(
      () => {
        ended = true;
        if (!stopping) fail('performance.recording_incomplete');
        detach();
      },
      () => {
        ended = true;
        fail('performance.transport_failed');
        detach();
      },
    );
    void recording.completed.catch(() => {
      fail('performance.transport_failed');
      detach();
    });
    await Promise.race([notified, failure]);
    if (ended || recording.isRunning?.() === false) fail('performance.recording_incomplete');
    signal.throwIfAborted();
    clearTimeout(timer);
    const child = recording;
    return {
      signal,
      failure: () => reason,
      completed: child.completed,
      stop: () => {
        stopping = true;
        child.stop();
      },
      cancel: () => {
        stopping = true;
        child.cancel();
      },
    };
  } catch {
    detach();
    recording?.cancel();
    subscriber?.cancel();
    await Promise.allSettled([recording?.completed, subscriber?.completed]);
    throw new Error(reason ?? 'performance.recording_not_ready');
  } finally {
    clearTimeout(timer);
  }
}
