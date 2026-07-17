import type { SSEHub } from './sse-hub.js';
import type { SessionInfo } from './types.js';

/** iTestAgent server version. */
const SERVER_VERSION = '0.0.1';

/** Timestamp of process start, used for /health uptime. */
const START_TIME = Date.now();

// ─── Route handler type ──────────────────────────────────────

/**
 * Request handler compatible with Bun.serve's fetch option.
 * Routes requests to the appropriate handler based on method + path.
 */
export function createFetchHandler(
  sseHub: SSEHub,
  sessions: Map<string, SessionInfo>,
): (req: Request) => Response | Promise<Response> {
  return (req: Request): Response | Promise<Response> => {
    const url = new URL(req.url);

    // GET /health — server status check.
    if (url.pathname === '/health' && req.method === 'GET') {
      return handleHealth();
    }

    // POST /session — create a new session.
    if (url.pathname === '/session' && req.method === 'POST') {
      return handleCreateSession(sessions);
    }

    // GET /session/:id — get session info.
    const sessionMatch = url.pathname.match(/^\/session\/([a-zA-Z0-9_-]+)$/);
    if (sessionMatch?.[1] && req.method === 'GET') {
      return handleGetSession(sessions, sessionMatch[1]);
    }

    // GET /events?sessionId=xxx — SSE event stream.
    if (url.pathname === '/events' && req.method === 'GET') {
      return handleSSE(url, sseHub, sessions);
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

function handleCreateSession(sessions: Map<string, SessionInfo>): Response {
  const sessionId = generateSessionId();
  const session: SessionInfo = {
    sessionId,
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  sessions.set(sessionId, session);
  return jsonResponse({ sessionId }, 201);
}

function handleGetSession(sessions: Map<string, SessionInfo>, sessionId: string): Response {
  const session = sessions.get(sessionId);
  if (!session) {
    return jsonResponse({ error: 'session_not_found', sessionId }, 404);
  }
  return jsonResponse(session);
}

function handleSSE(url: URL, sseHub: SSEHub, sessions: Map<string, SessionInfo>): Response {
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return jsonResponse(
      { error: 'missing_sessionId', message: 'Query parameter "sessionId" is required.' },
      400,
    );
  }

  if (!sessions.has(sessionId)) {
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

function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `ses_${timestamp}_${random}`;
}
