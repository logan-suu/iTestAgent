import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type PermissionEngine, PermissionRequestError } from './permission-engine.js';

const binding = z
  .object({
    sessionId: z.string().uuid(),
    requestId: z.string().uuid(),
    strategy: z.literal('pidReturn'),
    commandSHA256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** Engine-owned bridge. The view only presents the ask; all decisions resolve
 * through PermissionEngine. It cannot authorize through a remembered allow flag.
 */
export function createMemoryQueryPermission(input: {
  engine: Pick<PermissionEngine, 'requestPermission' | 'cancel' | 'check'>;
  resolved?(event: {
    callId: string;
    effect: 'allow' | 'deny';
    reason: 'decided' | 'cancelled' | 'timeout' | 'failed';
  }): void;
  publishAsk(ask: {
    callId: string;
    action: 'interact_sensitive_ui';
    resource: string;
    summary: string;
  }): void;
}) {
  return async (action: 'interact_sensitive_ui', resource: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (action !== 'interact_sensitive_ui' || Buffer.byteLength(resource) > 1024)
      throw new Error('query.permission_invalid');
    const request = binding.parse(JSON.parse(resource));
    const canonical = JSON.stringify(request);
    const gate = input.engine.check(action, canonical);
    if (gate === 'allow') throw new Error('query.permission_requires_ask');
    if (gate === 'deny') return { effect: 'deny' as const, remembered: false };
    const callId = `memory-query-${randomUUID()}`;
    const pending = input.engine.requestPermission(callId, action, canonical);
    const cancel = () => input.engine.cancel(callId, 'memory query cancelled');
    signal?.addEventListener('abort', cancel, { once: true });
    let effect: 'allow' | 'deny' = 'deny';
    let reason: 'decided' | 'cancelled' | 'timeout' | 'failed' = 'failed';
    try {
      if (signal?.aborted) cancel();
      else {
        try {
          input.publishAsk({
            callId,
            action,
            resource: canonical,
            summary: `Submit one fixed debugger query and one Return pair to the owned Xcode instance. Session ${request.sessionId}; request ${request.requestId}; command SHA256 ${request.commandSHA256}.`,
          });
        } catch {
          input.engine.cancel(callId, 'memory query prompt unavailable');
        }
      }
      const decision = await pending;
      signal?.throwIfAborted();
      if (decision.effect === 'allow' && decision.remembered)
        throw new Error('query.permission_invalid');
      effect = decision.effect;
      reason = 'decided';
      return decision;
    } catch (error) {
      reason = signal?.aborted
        ? 'cancelled'
        : error instanceof PermissionRequestError
          ? error.reason
          : 'failed';
      throw error;
    } finally {
      input.engine.cancel(callId, 'memory query ended');
      signal?.removeEventListener('abort', cancel);
      input.resolved?.({ callId, effect, reason });
    }
  };
}
