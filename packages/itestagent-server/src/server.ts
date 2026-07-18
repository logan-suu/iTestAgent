import { createFetchHandler } from './routes.js';
import type { SessionManager } from './session-manager.js';
import type { SSEHub } from './sse-hub.js';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from './types.js';

// ═══════════════════════════════════════════════════════════════
// Bun HTTP Server with SSE Hub
// ═══════════════════════════════════════════════════════════════

/**
 * Dependencies required by createServer().
 * Both SSE hub and session manager must share the same SSE hub instance.
 */
export interface ServerDependencies {
  sseHub: SSEHub;
  sessionManager: SessionManager;
}

/**
 * Result of createServer() — holds the running server,
 * the SSE hub for broadcasting events, and session state.
 */
export interface ServerInstance {
  server: ReturnType<typeof Bun.serve>;
  sseHub: SSEHub;
  sessionManager: SessionManager;
  /** Gracefully stops the server and cleans up all SSE connections. */
  close: () => void;
}

/**
 * Create and start a local Bun HTTP server with SSE support.
 *
 * Architecture §3: itestagent-server manages local long-running tasks,
 * SSE event streams, and session state — does NOT contain test strategy.
 */
export function createServer(
  config: Partial<ServerConfig> | undefined,
  deps: ServerDependencies,
): ServerInstance {
  const resolved = { ...DEFAULT_SERVER_CONFIG, ...config };
  const handler = createFetchHandler(deps.sseHub, deps.sessionManager);

  const server = Bun.serve({
    port: resolved.port,
    hostname: resolved.hostname,
    fetch: handler,
    idleTimeout: 0,
  });

  return {
    server,
    sseHub: deps.sseHub,
    sessionManager: deps.sessionManager,
    close: () => {
      deps.sessionManager.closeAll();
      deps.sseHub.closeAll();
      server.stop(true);
    },
  };
}
