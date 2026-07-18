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

/**
 * Session state tracked in memory.
 *
 * Architecture §3: SessionManager manages session creation/closing,
 * workspace, runId, SSE subscriber, and session isolation.
 * ADR-010 §4: Each session owns an independent run (runId)
 * tracked by RunStateMachine.
 */
export interface SessionInfo {
  /** Unique session identifier. */
  sessionId: string;
  /** Run identifier tied to this session (one run per session). */
  runId: string;
  /** Absolute path to the iOS project workspace. */
  workspace: string;
  /** Target device kind: physical iPhone or iOS Simulator (ADR-011). */
  targetKind: 'physical' | 'simulator';
  /** Selected device backend name (optional at creation time). */
  backend?: string;
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
