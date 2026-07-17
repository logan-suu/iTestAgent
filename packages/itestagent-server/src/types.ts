/**
 * Internal types for itestagent-server.
 *
 * Architecture §3: itestagent-server manages local long-running tasks,
 * SSE event streams, and session state — no test strategy decisions.
 */

// ─── SSESubscriber ───────────────────────────────────────────

/**
 * An active SSE subscriber connected to a specific session's event stream.
 * Each subscriber holds a ReadableStream controller for pushing events.
 */
export interface SSESubscriber {
  /** Session this subscriber is attached to. */
  sessionId: string;
  /** ReadableStream controller for pushing SSE data chunks. */
  controller: ReadableStreamDefaultController<Uint8Array>;
  /** Cleanup function called on unsubscribe (e.g. close controller). */
  cleanup: () => void;
}

// ─── SessionInfo ─────────────────────────────────────────────

/** Lightweight session state tracked in memory. */
export interface SessionInfo {
  /** Unique session identifier. */
  sessionId: string;
  /** ISO-8601 timestamp when the session was created. */
  createdAt: string;
  /** Current session lifecycle status. */
  status: 'active' | 'idle' | 'closed';
}

// ─── ServerConfig ────────────────────────────────────────────

/** Configuration for createServer(). */
export interface ServerConfig {
  /** Port to listen on. Default: 0 (auto-allocate). */
  port: number;
  /** Hostname to bind to. Default: '127.0.0.1'. */
  hostname: string;
}

/** Default server configuration. */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 0,
  hostname: '127.0.0.1',
};
