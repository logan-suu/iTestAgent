import {
  type MemoryQueryIPCBinding,
  memoryQueryBindingSchema,
} from './xcode-memory-query-protocol.js';
import { parseMemoryQueryResult } from './xcode-memory-query-session.js';
import { type MemoryQueryDuplex, runMemoryQueryTransport } from './xcode-memory-query-transport.js';
import type { reserveXcodeMemoryLease } from './xcode-memory-session.js';

/** One request, one prepared-time permission. The launch provider owns executable
 * verification and process creation. No parser or caller-supplied result authorizes UI.
 */
export function prepareMemoryIPCQuery(input: {
  binding: MemoryQueryIPCBinding;
  timeoutMs: number;
  lease: ReturnType<typeof reserveXcodeMemoryLease>;
  signal?: AbortSignal;
  launchVerified(signal?: AbortSignal): MemoryQueryDuplex;
  permission(
    resource: string,
    signal: AbortSignal,
  ): Promise<{ effect: 'allow' | 'deny'; remembered: boolean }>;
}) {
  const binding = Object.freeze(memoryQueryBindingSchema.parse(input.binding));
  if (
    binding.sessionId !== input.lease.sessionId ||
    !Number.isFinite(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 150000
  )
    throw new Error('query.configuration_invalid');
  let consumed = false;
  const failure = (status: string, grantAttempted = false) => ({
    status,
    grantAttempted,
    targetVerified: false as const,
    leaseRetained: true as const,
  });
  return {
    async executeOnce() {
      if (consumed) return failure('already_consumed');
      consumed = true;
      if (input.signal?.aborted) return failure('cancelled');
      const launcher = input.lease.resources.begin('launcher');
      // A launcher may start its helper before returning or even before throwing.
      // Without an independent helper owner observation that attempt stays unknown.
      const helper = input.lease.resources.begin('helper');
      let granted = false;
      try {
        const channel = input.launchVerified(input.signal);
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
            input.lease.resources.closed(launcher, channel);
          })
          .catch(() => input.lease.resources.unknown(launcher));
        let asked = false;
        const result = await runMemoryQueryTransport({
          ...input,
          binding,
          channel,
          permission(resource, signal) {
            asked = true;
            return input.permission(resource, signal);
          },
        });
        granted = result.grantAttempted;
        input.lease.resources.unknown(helper);
        if (input.signal?.aborted) return failure('cancelled', granted);
        if (result.status !== 'query_closed') return failure('query_unverified', granted);
        if (!result.result)
          return failure(
            granted ? 'missing_response' : asked ? 'not_authorized' : 'unsupported',
            granted,
          );
        return { ...parseMemoryQueryResult(result.result, binding), grantAttempted: granted };
      } catch {
        input.lease.resources.unknown(helper);
        return failure(input.signal?.aborted ? 'cancelled' : 'query_failed', granted);
      }
    },
  };
}
