/** A cancellable bounded wait; listeners and timers never outlive this operation. */
export async function waitForObservation(durationMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (durationMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(new Error('performance.cancelled'));
    };
    const timer = setTimeout(() => {
      stop();
      resolve();
    }, durationMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
