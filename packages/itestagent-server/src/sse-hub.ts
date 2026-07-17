import type { AgentEvent } from 'itestagent-contracts';
import { isTerminalEvent } from 'itestagent-contracts';
import type { SSESubscriber } from './types.js';

/**
 * SSE Hub — Server-Sent Events channel with session isolation.
 *
 * Architecture §7.4: SSE must be ordered, traceable, terminal-event-unique,
 * reconnectable, and isolated per session.
 *
 * Each sessionId has its own set of subscribers. Broadcasts are
 * session-scoped — subscribers for session A never receive events
 * from session B.
 */
export class SSEHub {
  /** SessionId → Set of active subscribers. */
  private subscribers = new Map<string, Set<SSESubscriber>>();

  /**
   * Subscribe to events for a given session.
   *
   * Returns a ReadableStream that the caller can pass as a Response body
   * for SSE delivery. The stream closes when a terminal event is broadcast
   * or when the subscriber is explicitly unsubscribed.
   */
  subscribe(sessionId: string): ReadableStream<Uint8Array> {
    // ReadableStream start() runs synchronously — controller is assigned before use.
    let controller!: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });

    const subscriber: SSESubscriber = {
      sessionId,
      controller,
      cleanup: () => {
        try {
          controller.close();
        } catch {
          // Controller may already be closed.
        }
      },
    };

    this.getOrCreateSession(sessionId).add(subscriber);

    // Remove subscriber when the client disconnects.
    const originalCleanup = subscriber.cleanup;
    subscriber.cleanup = () => {
      const set = this.subscribers.get(sessionId);
      if (set) {
        set.delete(subscriber);
        if (set.size === 0) {
          this.subscribers.delete(sessionId);
        }
      }
      originalCleanup();
    };

    return stream;
  }

  /**
   * Broadcast an AgentEvent to all subscribers of the given session.
   *
   * If the event is terminal (isTerminalEvent returns true), all subscribers
   * for that session are automatically cleaned up after delivery.
   */
  broadcast(sessionId: string, event: AgentEvent): void {
    const set = this.subscribers.get(sessionId);
    if (!set || set.size === 0) {
      return;
    }

    const encoded = this.encodeSSE(event);

    for (const sub of set) {
      try {
        sub.controller.enqueue(encoded);
      } catch {
        // Subscriber's stream may already be closed — skip.
      }
    }

    // Terminal events close the session's SSE channel.
    if (isTerminalEvent(event)) {
      this.closeSession(sessionId);
    }
  }

  /**
   * Unsubscribe a specific subscriber from a session.
   */
  unsubscribe(sessionId: string, subscriber: SSESubscriber): void {
    subscriber.cleanup();
  }

  /**
   * Close all subscribers for a session and remove the session entry.
   */
  closeSession(sessionId: string): void {
    const set = this.subscribers.get(sessionId);
    if (!set) {
      return;
    }

    for (const sub of set) {
      try {
        sub.cleanup();
      } catch {
        // Ignore cleanup errors.
      }
    }

    this.subscribers.delete(sessionId);
  }

  /**
   * Close all sessions and subscribers. Used during server shutdown.
   */
  closeAll(): void {
    for (const sessionId of [...this.subscribers.keys()]) {
      this.closeSession(sessionId);
    }
  }

  /**
   * Return the number of active sessions (sessions with at least one subscriber).
   */
  get sessionCount(): number {
    return this.subscribers.size;
  }

  /**
   * Encode an AgentEvent as an SSE data frame.
   *
   * Format: `data: {JSON}\n\n`
   * Includes `event:` for the event type and `id:` for monotonic tracking.
   */
  private eventCounter = 0;

  private encodeSSE(event: AgentEvent): Uint8Array {
    this.eventCounter += 1;
    const lines = [
      `event: ${event.type}`,
      `id: ${this.eventCounter}`,
      `data: ${JSON.stringify(event)}`,
      '', // Blank line terminates the message.
    ];
    return new TextEncoder().encode(lines.join('\n'));
  }

  // ─── Private helpers ───────────────────────────────────────

  private getOrCreateSession(sessionId: string): Set<SSESubscriber> {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    return set;
  }
}
