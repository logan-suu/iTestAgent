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
    const sessionMatch = url.pathname.match(/^\/session\/([a-zA-Z0-9_-]+)$/);
    if (sessionMatch?.[1] && req.method === 'GET') {
      return handleGetSession(sessionManager, sessionMatch[1]);
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
