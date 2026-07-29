import type { AgentEvent } from 'itestagent-contracts';
import { isTerminalEvent } from 'itestagent-contracts';
import type { SSESubscriber } from './types.js';

const EVENT_BUFFER_SIZE = 64;
const HEARTBEAT_INTERVAL_MS = 30_000;

interface SessionState {
  subscribers: Set<SSESubscriber>;
  eventCounter: number;
  buffer: Uint8Array[];
  heartbeat: ReturnType<typeof setInterval> | null;
}

/**
 * SSE Hub — Server-Sent Events channel with session isolation.
 *
 * Architecture §7.4: SSE must be ordered, traceable, terminal-event-unique,
 * reconnectable, and isolated per session.
 *
 * Each sessionId has its own event counter, ring buffer for replay,
 * and heartbeat keepalive. Subscribers are cleaned up on client disconnect
 * via ReadableStream cancel callback.
 */
export class SSEHub {
  /** SessionId → session state. */
  private sessions = new Map<string, SessionState>();

  /**
   * Subscribe to events for a given session.
   *
   * Returns a ReadableStream that the caller can pass as a Response body
   * for SSE delivery. On client disconnect, the cancel callback removes
   * the subscriber. The stream closes when a terminal event is broadcast
   * or when the subscriber is explicitly unsubscribed.
   *
   * Supports Last-Event-ID for reconnection: if the client sends
   * Last-Event-ID header, buffered events after that ID are replayed first.
   */
  subscribe(sessionId: string, lastEventId?: number): ReadableStream<Uint8Array> {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const hub = this;

    // Create subscriber first (referenced by cancel callback)
    const subscriber: SSESubscriber = {
      sessionId,
      get controller() {
        return controller;
      },
      cleanup: () => {
        try {
          controller.close();
        } catch {
          /* closed */
        }
      },
    };

    const wrappedCleanup = subscriber.cleanup;
    subscriber.cleanup = () => {
      hub.removeSubscriberRaw(sessionId, subscriber);
      wrappedCleanup();
    };

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        const state = hub.sessions.get(sessionId);
        if (state && lastEventId !== undefined) {
          for (const chunk of state.buffer.slice(lastEventId)) {
            try {
              c.enqueue(chunk);
            } catch {
              break;
            }
          }
        }
      },
      cancel() {
        subscriber.cleanup();
      },
    });

    const state = hub.getOrCreateSession(sessionId);
    state.subscribers.add(subscriber);
    hub.ensureHeartbeat(sessionId);

    return stream;
  }

  /**
   * Broadcast an AgentEvent to all subscribers of the given session.
   *
   * Each event is assigned a session-scoped monotonic ID and buffered
   * for reconnection replay. Terminal events close the session's SSE
   * channel and stop the heartbeat.
   */
  broadcast(sessionId: string, event: AgentEvent): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.subscribers.size === 0) return;

    state.eventCounter += 1;
    const encoded = this.encodeSSE(event, state.eventCounter);

    // Ring buffer for replay
    if (state.buffer.length >= EVENT_BUFFER_SIZE) {
      state.buffer.shift();
    }
    state.buffer.push(encoded);

    for (const sub of state.subscribers) {
      try {
        sub.controller.enqueue(encoded);
      } catch {
        /* skip */
      }
    }

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

  closeSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    this.stopHeartbeat(sessionId);

    for (const sub of state.subscribers) {
      try {
        sub.cleanup();
      } catch {
        /* skip */
      }
    }

    this.sessions.delete(sessionId);
  }

  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.closeSession(sessionId);
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  private encodeSSE(event: AgentEvent, eventId: number): Uint8Array {
    const lines = [`event: ${event.type}`, `id: ${eventId}`, `data: ${JSON.stringify(event)}`, ''];
    return new TextEncoder().encode(lines.join('\n'));
  }

  private getOrCreateSession(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        subscribers: new Set(),
        eventCounter: 0,
        buffer: [],
        heartbeat: null,
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private removeSubscriber(sessionId: string, subscriber: SSESubscriber): void {
    this.removeSubscriberRaw(sessionId, subscriber);
    subscriber.cleanup();
  }

  private removeSubscriberRaw(sessionId: string, subscriber: SSESubscriber): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.subscribers.delete(subscriber);
    if (state.subscribers.size === 0) {
      this.stopHeartbeat(sessionId);
    }
  }

  private ensureHeartbeat(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.heartbeat) return;

    state.heartbeat = setInterval(() => {
      const s = this.sessions.get(sessionId);
      if (!s || s.subscribers.size === 0) {
        this.stopHeartbeat(sessionId);
        return;
      }
      for (const sub of s.subscribers) {
        try {
          sub.controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
        } catch {
          /* skip */
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state?.heartbeat) {
      clearInterval(state.heartbeat);
      state.heartbeat = null;
    }
  }
}
