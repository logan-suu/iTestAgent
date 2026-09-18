export interface CaptureProcess {
  completed: Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    failure: string | undefined;
  }>;
  stop(): void;
  cancel(): void;
  isRunning?(): boolean;
  exited?: Promise<number>;
}

/** Owned, bounded subprocess transport. Raw output never enters progress or error messages. */
export function startCaptureProcess(
  command: string[],
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    stopGraceMs?: number;
    onOutput?: (text: string) => void;
  },
): CaptureProcess {
  options.signal?.throwIfAborted();
  const child = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let failure: string | undefined;
  let bytes = 0;
  const terminate = (reason?: string, signal: 'SIGINT' | 'SIGTERM' = 'SIGTERM') => {
    failure ??= reason;
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (escalation && !reason) return;
    clearTimeout(escalation);
    child.kill(signal);
    escalation = setTimeout(
      () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      },
      reason ? 2_000 : (options.stopGraceMs ?? 2_000),
    );
  };
  const abort = () => terminate('performance.cancelled');
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => terminate('performance.process_timeout'), options.timeoutMs);
  async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8 * 1024 * 1024) {
          terminate('performance.output_limit');
          continue;
        }
        const chunk = decoder.decode(value, { stream: true });
        text += chunk;
        options.onOutput?.(chunk);
      }
      return text + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  const completed = Promise.all([drain(child.stdout), drain(child.stderr), child.exited])
    .then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode, failure }))
    .catch(async () => {
      terminate('performance.transport_failed');
      await child.exited;
      throw new Error('performance.transport_failed');
    })
    .finally(() => {
      clearTimeout(timer);
      clearTimeout(escalation);
      options.signal?.removeEventListener('abort', abort);
    });
  return {
    completed,
    exited: child.exited,
    isRunning: () => child.exitCode === null && child.signalCode === null,
    stop: () => terminate(undefined, 'SIGINT'),
    cancel: () => terminate('performance.cancelled'),
  };
}
