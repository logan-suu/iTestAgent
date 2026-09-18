import { type PermissionEngine, createMemoryQueryPermission } from 'itestagent-engine';
import type { TuiStatePatch } from './agent-session.js';

/** Shares the session's normal permission response/cancellation path. */
export function createTuiMemoryQueryPermission(input: {
  engine: PermissionEngine;
  pendingIds: Set<string>;
  pending: Map<string, { action: string; resource: string }>;
  publish(patch: TuiStatePatch): void;
}) {
  return createMemoryQueryPermission({
    engine: input.engine,
    publishAsk(ask) {
      input.pendingIds.add(ask.callId);
      input.pending.set(ask.callId, { action: ask.action, resource: ask.resource });
      input.publish({ type: 'message_add', payload: { role: 'system', text: ask.summary } });
      input.publish({
        type: 'permission_request',
        payload: { ...ask, timeoutMs: input.engine.getAskTimeoutMs() },
      });
    },
    resolved(event) {
      input.pendingIds.delete(event.callId);
      input.pending.delete(event.callId);
      try {
        input.publish({ type: 'permission_resolved', payload: event });
      } finally {
        input.publish({ type: 'activity_update', payload: { id: event.callId, complete: true } });
      }
    },
  });
}
