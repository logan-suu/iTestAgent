import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { launchMemoryNoTargetCandidate } from './xcode-memory-query-candidate.js';
import {
  type MemoryQueryIPCBinding,
  memoryQueryBindingSchema,
} from './xcode-memory-query-protocol.js';
import type { reserveXcodeMemoryLease } from './xcode-memory-session.js';

const base = memoryQueryBindingSchema.extend({
  protocolVersion: z.literal(4),
  manifestSHA256: z.string().regex(/^[a-f0-9]{64}$/),
  launchInstanceId: z.string().uuid(),
  sequence: z.number().int().positive().safe(),
  challenge: z.string().regex(/^[a-f0-9]{64}$/),
});
export const memoryNoTargetFrameSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('hello_ack') }).strict(),
  base.extend({ kind: z.literal('closing') }).strict(),
  base.extend({ kind: z.literal('closed') }).strict(),
  base
    .extend({
      kind: z.literal('launcher_closure'),
      scope: z.literal('no_target_resources'),
      helper: z.literal('exited'),
    })
    .strict(),
]);

/** Explicit v4 no-target entry. Only the resolver's opaque capability can launch.
 * No external JSON, caller channel, or boolean can authorize resource closure.
 * Verification and capability consumption stay inside this single-use execution.
 */
export function prepareMemoryNoTargetQuery(input: {
  candidate: object;
  binding: MemoryQueryIPCBinding;
  lease: ReturnType<typeof reserveXcodeMemoryLease>;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const binding = Object.freeze(memoryQueryBindingSchema.parse(input.binding));
  if (
    binding.sessionId !== input.lease.sessionId ||
    !Number.isFinite(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 150000
  )
    throw new Error('query.configuration_invalid');
  let used = false;
  return {
    async executeOnce() {
      const failure = (status: string) => ({
        status,
        leaseRetained: true,
        targetVerified: false,
        grantAttempted: false,
      });
      if (used) return failure('already_consumed');
      used = true;
      if (input.signal?.aborted) return failure('cancelled');
      // Identity and downstream attempts are forbidden even if subsequently closed.
      if (
        !input.lease.resources.noTargetEligible ||
        Object.values(input.lease.resources.snapshot()).some((s) => s !== 'not_created')
      )
        return failure('query_scope_invalid');
      const launcher = input.lease.resources.begin('launcher');
      const helper = input.lease.resources.begin('helper');
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      input.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(onAbort, Math.min(input.timeoutMs, 5000));
      let cancel: (() => void) | undefined;
      let verified = false;
      const interrupted = new Promise<never>((_, reject) => {
        abort.signal.addEventListener(
          'abort',
          () => {
            cancel?.();
            reject(new Error('query.cancelled'));
          },
          { once: true },
        );
      });
      void interrupted.catch(() => {});
      const wait = <T>(value: Promise<T>) => Promise.race([value, interrupted]);
      try {
        if (input.signal?.aborted) abort.abort();
        abort.signal.throwIfAborted();
        const launched = launchMemoryNoTargetCandidate(input.candidate, abort.signal);
        const { channel, manifestSHA256 } = launched;
        let cancelled = false;
        cancel = () => {
          if (!cancelled) {
            cancelled = true;
            channel.cancel();
          }
        };
        let exited = false;
        input.lease.resources.acquired(
          launcher,
          channel,
          () => true,
          () => exited,
        );
        void channel.exited
          .then(() => {
            exited = true;
          })
          .catch(() => {});
        const challenge = randomBytes(32).toString('hex');
        await wait(
          channel.write(
            new TextEncoder().encode(
              `${JSON.stringify({
                ...binding,
                protocolVersion: 4,
                sequence: 1,
                challenge,
                kind: 'hello',
              })}\n`,
            ),
            abort.signal,
          ),
        );
        let buffer = Buffer.alloc(0);
        const order = ['hello_ack', 'closing', 'closed', 'launcher_closure'];
        let next = 0;
        let instance: string | undefined;
        for (;;) {
          const chunk = await wait(channel.read(abort.signal));
          if (chunk === undefined) break;
          if (buffer.length + chunk.length > 32768) throw new Error('query.frame_invalid');
          buffer = Buffer.concat([buffer, chunk]);
          let newline = buffer.indexOf(10);
          while (newline !== -1) {
            if (newline === 0 || newline > 16384) throw new Error('query.frame_invalid');
            const frame = memoryNoTargetFrameSchema.parse(
              JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, newline)),
              ),
            );
            if (
              frame.kind !== order[next] ||
              frame.sequence !== next + 2 ||
              frame.challenge !== challenge ||
              Object.keys(binding).some(
                (key) =>
                  frame[key as keyof MemoryQueryIPCBinding] !==
                  binding[key as keyof MemoryQueryIPCBinding],
              )
            )
              throw new Error('query.frame_invalid');
            if (
              frame.manifestSHA256 !== manifestSHA256 ||
              (instance !== undefined && frame.launchInstanceId !== instance)
            )
              throw new Error('query.candidate_changed');
            instance = frame.launchInstanceId;
            next++;
            buffer = buffer.subarray(newline + 1);
            newline = buffer.indexOf(10);
          }
          if (buffer.length > 16384) throw new Error('query.frame_invalid');
        }
        if (next !== 4 || buffer.length !== 0 || !instance)
          throw new Error('query.closure_missing');
        const exit = await wait(channel.exited);
        abort.signal.throwIfAborted();
        if (exit.code !== 0 || !exit.stderrEmpty || !input.lease.resources.noTargetEligible)
          throw new Error('query.closure_invalid');
        launched.revalidate();
        // This private object is minted only after all wire/process/profile evidence.
        // The ledger adds its own per-session, one-use capability before lease removal.
        const proofOwner = Object.freeze({ instance });
        verified = true;
        input.lease.resources.acquired(
          helper,
          proofOwner,
          () => verified,
          () => verified,
        );
        input.lease.resources.closed(helper, proofOwner);
        input.lease.resources.closed(launcher, channel);
        input.lease.releaseResources(input.lease.resources.prove());
        return {
          status: 'unsupported',
          leaseRetained: false,
          targetVerified: false,
          grantAttempted: false,
        };
      } catch {
        cancel?.();
        if (!verified) {
          input.lease.resources.unknown(helper);
          input.lease.resources.unknown(launcher);
        }
        return failure(input.signal?.aborted ? 'cancelled' : 'query_unverified');
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
