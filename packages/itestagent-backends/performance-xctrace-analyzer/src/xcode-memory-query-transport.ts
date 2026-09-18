import {
  MemoryQueryFrameDecoder,
  type MemoryQueryIPCBinding,
  MemoryQueryIPCProtocol,
} from './xcode-memory-query-protocol.js';

export interface MemoryQueryDuplex {
  read(signal: AbortSignal): Promise<Uint8Array | undefined>;
  write(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Closes the owned control channel; never force-kills the resource owner. */
  cancel(): void;
  /** Resolves only after the owned launcher exits. Timeout is not an exit proof. */
  exited: Promise<{ code: number; stderrEmpty: boolean }>;
}

/** Internal no-retry transport. Native launcher authenticates its App peer. Closed
 * protocol frames are not resource proofs and this function never releases a lease.
 */
export async function runMemoryQueryTransport(input: {
  binding: MemoryQueryIPCBinding;
  timeoutMs: number;
  signal?: AbortSignal;
  channel: MemoryQueryDuplex;
  permission(
    resource: string,
    signal: AbortSignal,
  ): Promise<{ effect: 'allow' | 'deny'; remembered: boolean }>;
}) {
  const abort = new AbortController();
  const now = () => performance.now();
  const duration = input.timeoutMs;
  let protocol: MemoryQueryIPCProtocol;
  try {
    if (!Number.isFinite(duration) || duration < 1 || duration > 150000)
      throw new Error('query.timeout_invalid');
    protocol = new MemoryQueryIPCProtocol(input.binding, now() + duration, now);
  } catch {
    input.channel.cancel();
    throw new Error('query.configuration_invalid');
  }
  const decoder = new MemoryQueryFrameDecoder();
  const outerAbort = () => abort.abort();
  input.signal?.addEventListener('abort', outerAbort, { once: true });
  if (input.signal?.aborted) abort.abort();
  const timer = setTimeout(() => abort.abort(), duration);
  let result: string | undefined;
  let phaseTimer: ReturnType<typeof setTimeout> | undefined;
  const phase = (milliseconds: number) => {
    if (phaseTimer) clearTimeout(phaseTimer);
    phaseTimer = setTimeout(() => abort.abort(), milliseconds);
  };
  let cancelled = false;
  const cancel = () => {
    if (!cancelled) {
      cancelled = true;
      input.channel.cancel();
    }
  };
  abort.signal.addEventListener('abort', cancel, { once: true });
  // Even a non-cooperative adapter cannot leave permission/read waits hanging.
  const interrupted = new Promise<never>((_, reject) => {
    const rejectAbort = () => reject(new Error('query.cancelled'));
    if (abort.signal.aborted) rejectAbort();
    else abort.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  void interrupted.catch(() => {});
  const wait = <T>(work: Promise<T>) => Promise.race([work, interrupted]);
  try {
    abort.signal.throwIfAborted();
    phase(5000);
    await wait(input.channel.write(new TextEncoder().encode(protocol.hello()), abort.signal));
    let pendingRead: Promise<Uint8Array | undefined> | undefined;
    for (;;) {
      const chunk = await wait(pendingRead ?? input.channel.read(abort.signal));
      pendingRead = undefined;
      if (chunk === undefined) {
        decoder.end();
        protocol.end();
        break;
      }
      const frames = decoder.push(chunk);
      for (const [index, frame] of frames.entries()) {
        const value = protocol.receive(frame);
        if (value !== undefined) result = value;
        if (frame.kind === 'prepared') {
          if (index !== frames.length - 1 || decoder.pendingBytes !== 0)
            throw new Error('query.premature_frame');
          phase(120000);
          pendingRead = input.channel.read(abort.signal);
          const premature = pendingRead.then(() => {
            throw new Error('query.peer_changed_during_permission');
          });
          const decision = await wait(
            Promise.race([
              input.permission(JSON.stringify(protocol.binding), abort.signal),
              premature,
            ]),
          );
          abort.signal.throwIfAborted();
          if (decision.effect === 'allow' && decision.remembered)
            throw new Error('query.permission_invalid');
          const line = protocol.decision(decision.effect);
          if (phaseTimer) clearTimeout(phaseTimer);
          await wait(input.channel.write(new TextEncoder().encode(line), abort.signal));
        }
      }
    }
    const exit = await wait(input.channel.exited);
    if (exit.code !== 0 || !exit.stderrEmpty) throw new Error('query.launcher_exit_unverified');
    return {
      status: 'query_closed' as const,
      result,
      grantAttempted: protocol.grantAttempted,
      launcherExited: true,
      leaseRetained: true as const,
      targetVerified: false as const,
    };
  } catch {
    protocol.fail();
    abort.abort();
    cancel();
    return {
      status: 'query_unverified' as const,
      grantAttempted: protocol.grantAttempted,
      launcherExited: false,
      leaseRetained: true as const,
      targetVerified: false as const,
    };
  } finally {
    clearTimeout(timer);
    if (phaseTimer) clearTimeout(phaseTimer);
    input.signal?.removeEventListener('abort', outerAbort);
    abort.signal.removeEventListener('abort', cancel);
  }
}
