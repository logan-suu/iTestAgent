import type { AgentRuntime, ToolCall } from 'itestagent-contracts';
import { ToolCallSchema } from 'itestagent-contracts';
import type { ServerToolExecutor } from './server.js';
import type { SessionManager } from './session-manager.js';
import type { SSEHub } from './sse-hub.js';

/** iTestAgent server version. */
const SERVER_VERSION = '0.0.1';

/** Timestamp of process start, used for /health uptime. */
const START_TIME = Date.now();

/** Valid targetKind values per ADR-011. */
const VALID_TARGET_KINDS = ['physical', 'simulator'] as const;

// ─── Route handler type ──────────────────────────────────────

/**
 * Request handler compatible with Bun.serve's fetch option.
 * Routes requests to the appropriate handler based on method + path.
 */
export function createFetchHandler(
  sseHub: SSEHub,
  sessionManager: SessionManager,
  agentRuntime?: AgentRuntime,
  toolExecutor?: ServerToolExecutor,
): (req: Request) => Response | Promise<Response> {
  return (req: Request): Response | Promise<Response> => {
    const url = new URL(req.url);

    // GET /health — server status check.
    if (url.pathname === '/health' && req.method === 'GET') {
      return handleHealth();
    }

    // POST /session — create a new session.
    if (url.pathname === '/session' && req.method === 'POST') {
      return handleCreateSession(req, sessionManager);
    }

    // GET /session/:id — get session info.
    const sessionGetMatch = url.pathname.match(/^\/session\/([a-zA-Z0-9_-]+)$/);
    if (sessionGetMatch?.[1] && req.method === 'GET') {
      return handleGetSession(sessionManager, sessionGetMatch[1]);
    }

    // POST /session/:id/execute — dispatch a tool call through the execution chain.
    const executeMatch = url.pathname.match(/^\/session\/([a-zA-Z0-9_-]+)\/execute$/);
    if (executeMatch?.[1] && req.method === 'POST') {
      return handleExecute(
        req,
        sessionManager,
        sseHub,
        agentRuntime,
        toolExecutor,
        executeMatch[1],
      );
    }

    // GET /events?sessionId=xxx — SSE event stream.
    if (url.pathname === '/events' && req.method === 'GET') {
      return handleSSE(url, sseHub, sessionManager);
    }

    // 404 for unmatched routes.
    return jsonResponse({ error: 'not_found' }, 404);
  };
}

// ─── Route handlers ──────────────────────────────────────────

function handleHealth(): Response {
  return jsonResponse({
    status: 'ok',
    version: SERVER_VERSION,
    uptime: Date.now() - START_TIME,
  });
}

async function handleCreateSession(
  req: Request,
  sessionManager: SessionManager,
): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Empty body or non-JSON — treated as missing fields.
  }

  const { workspace, targetKind, backend } = body;

  if (!workspace || typeof workspace !== 'string') {
    return jsonResponse(
      { error: 'invalid_request', message: '"workspace" (string) is required.' },
      400,
    );
  }

  if (!VALID_TARGET_KINDS.includes(targetKind as (typeof VALID_TARGET_KINDS)[number])) {
    return jsonResponse(
      { error: 'invalid_request', message: '"targetKind" must be "physical" or "simulator".' },
      400,
    );
  }

  const session = sessionManager.createSession({
    workspace,
    targetKind: targetKind as 'physical' | 'simulator',
    backend: typeof backend === 'string' ? backend : undefined,
  });

  return jsonResponse(session, 201);
}

function handleGetSession(sessionManager: SessionManager, sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return jsonResponse({ error: 'session_not_found', sessionId }, 404);
  }
  return jsonResponse(session);
}

async function handleExecute(
  req: Request,
  sessionManager: SessionManager,
  sseHub: SSEHub,
  agentRuntime: AgentRuntime | undefined,
  toolExecutor: ServerToolExecutor | undefined,
  sessionId: string,
): Promise<Response> {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return jsonResponse({ error: 'session_not_found', sessionId }, 404);
  }

  if (!toolExecutor) {
    return jsonResponse(
      { error: 'not_configured', message: 'Server has no tool executor configured.' },
      501,
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(
      { error: 'invalid_body', message: 'Request body must be valid JSON.' },
      400,
    );
  }

  const parsed = ToolCallSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: 'invalid_tool_call', issues: parsed.error.issues }, 400);
  }
  const toolCall = parsed.data;

  try {
    const result = await toolExecutor(toolCall);

    if (result.status === 'error') {
      sseHub.broadcast(sessionId, {
        type: 'tool.failed',
        callId: result.callId,
        error: {
          code: 'backend.error',
          message: String(
            (result.output as Record<string, unknown> | undefined)?.error ?? 'Unknown error',
          ),
        },
      });
    } else {
      sseHub.broadcast(sessionId, {
        type: 'tool.completed',
        callId: result.callId,
        result,
      });
    }

    return jsonResponse(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'execute_failed', message }, 500);
  }
}

function handleSSE(url: URL, sseHub: SSEHub, sessionManager: SessionManager): Response {
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return jsonResponse(
      { error: 'missing_sessionId', message: 'Query parameter "sessionId" is required.' },
      400,
    );
  }

  if (!sessionManager.getSession(sessionId)) {
    return jsonResponse({ error: 'session_not_found', sessionId }, 404);
  }

  const stream = sseHub.subscribe(sessionId);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Session-Id': sessionId,
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
