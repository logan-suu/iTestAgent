/**
 * Agent stream — B29 module split (promotion guide §11.3 "agent
 * session/stream/retention").
 *
 * Minimal push/subscribe event stream for agent events.
 */
export interface AgentStream<T> {
  push(event: T): void;
  subscribe(listener: (event: T) => void): () => void;
}

export function createAgentStream<T>(): AgentStream<T> {
  const listeners = new Set<(event: T) => void>();
  return {
    push(event: T): void {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener: (event: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
