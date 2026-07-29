import type { AgentRuntime, ToolCall, ToolResult } from 'itestagent-contracts';
import { createFetchHandler } from './routes.js';
import type { SessionManager } from './session-manager.js';
import type { SSEHub } from './sse-hub.js';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from './types.js';

// ═══════════════════════════════════════════════════════════════
// Bun HTTP Server with SSE Hub
// ═══════════════════════════════════════════════════════════════

/**
 * Tool execution function — dispatched by server routes for tool calls.
 * Accepts a ToolCall and returns a ToolResult.
 */
export type ServerToolExecutor = (call: ToolCall) => Promise<ToolResult>;

/**
 * Dependencies required by createServer().
 * Both SSE hub and session manager must share the same SSE hub instance.
 * AgentRuntime and toolExecutor are optional — omit for session-only servers.
 */
export interface ServerDependencies {
  sseHub: SSEHub;
  sessionManager: SessionManager;
  agentRuntime?: AgentRuntime;
  toolExecutor?: ServerToolExecutor;
}

/**
 * Result of createServer() — holds the running server,
 * the SSE hub for broadcasting events, session state,
 * and the execution chain for tool dispatch.
 */
export interface ServerInstance {
  server: ReturnType<typeof Bun.serve>;
  sseHub: SSEHub;
  sessionManager: SessionManager;
  agentRuntime?: AgentRuntime;
  toolExecutor?: ServerToolExecutor;
  /** Gracefully stops the server and cleans up all SSE connections. */
  close: () => void;
}

/**
 * Create and start a local Bun HTTP server with SSE support.
 *
 * Architecture §3: itestagent-server manages local long-running tasks,
 * SSE event streams, session state, and tool-execution dispatch —
 * does NOT contain test strategy or decide which tools to call.
 */
export function createServer(
  config: Partial<ServerConfig> | undefined,
  deps: ServerDependencies,
): ServerInstance {
  const resolved = { ...DEFAULT_SERVER_CONFIG, ...config };
  const handler = createFetchHandler(
    deps.sseHub,
    deps.sessionManager,
    deps.agentRuntime,
    deps.toolExecutor,
  );

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
    agentRuntime: deps.agentRuntime,
    toolExecutor: deps.toolExecutor,
    close: () => {
      deps.sessionManager.closeAll();
      deps.sseHub.closeAll();
      server.stop(true);
    },
  };
}
