import type { Server } from 'bun';
import { createFetchHandler } from './routes.js';
import { SSEHub } from './sse-hub.js';
import { DEFAULT_SERVER_CONFIG, type ServerConfig, type SessionInfo } from './types.js';

// ═══════════════════════════════════════════════════════════════
// Bun HTTP Server with SSE Hub
// ═══════════════════════════════════════════════════════════════

/**
 * Result of createServer() — holds the running server,
 * the SSE hub for broadcasting events, and session state.
 */
export interface ServerInstance {
  /** The underlying Bun HTTP server. */
  server: ReturnType<typeof Bun.serve>;
  /** SSE hub for publishing events to connected subscribers. */
  sseHub: SSEHub;
  /** In-memory session registry (sessionId → SessionInfo). */
  sessions: Map<string, SessionInfo>;
  /** Gracefully stops the server and cleans up all SSE connections. */
  close: () => void;
}

/**
 * Create and start a local Bun HTTP server with SSE support.
 *
 * Architecture §3: itestagent-server manages local long-running tasks,
 * SSE event streams, and session state — does NOT contain test strategy.
 *
 * @param config - Partial server configuration. Merged with defaults.
 * @returns ServerInstance with server, sseHub, sessions, and close handler.
 */
export function createServer(config?: Partial<ServerConfig>): ServerInstance {
  const resolved = { ...DEFAULT_SERVER_CONFIG, ...config };

  const sseHub = new SSEHub();
  const sessions = new Map<string, SessionInfo>();
  const handler = createFetchHandler(sseHub, sessions);

  const server = Bun.serve({
    port: resolved.port,
    hostname: resolved.hostname,
    fetch: handler,
    // SSE connections are long-lived; 0 disables idle timeout.
    idleTimeout: 0,
  });

  return {
    server,
    sseHub,
    sessions,
    close: () => {
      sseHub.closeAll();
      server.stop(true);
    },
  };
}
