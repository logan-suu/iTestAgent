import { describe, expect, test } from 'bun:test';
import { createFetchHandler } from '../src/routes.js';
import { type ServerInstance, createServer } from '../src/server.js';
import { SSEHub } from '../src/sse-hub.js';
import type { SessionInfo } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────

/** JSON body shape for generic responses. */
type JsonBody = Record<string, unknown>;

function url(instance: ServerInstance, path: string): string {
  const addr = instance.server;
  return `http://${addr.hostname}:${addr.port}${path}`;
}

/** Create a server, run the test, then ensure cleanup. */
async function withServer<T>(fn: (inst: ServerInstance) => Promise<T>): Promise<T> {
  const inst = createServer({ port: 0 });
  try {
    return await fn(inst);
  } finally {
    inst.close();
  }
}

/** Build a minimal Request object for testing route handlers directly. */
function makeReq(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method });
}

/**
 * Call a route handler and assert it returns a synchronous Response.
 * All non-404/SSE routes in our handler return synchronously.
 */
function callHandler(handler: ReturnType<typeof createFetchHandler>, req: Request): Response {
  const result = handler(req);
  if (result instanceof Promise) {
    throw new Error('Handler returned a Promise; expected synchronous Response');
  }
  return result;
}

// ─── HTTP-level tests (non-streaming endpoints) ──────────────

describe('Server /health', () => {
  test('GET /health returns 200 with status ok', () =>
    withServer(async (inst) => {
      const res = await fetch(url(inst, '/health'));
      expect(res.status).toBe(200);

      const body = (await res.json()) as JsonBody;
      expect(body.status).toBe('ok');
      expect(body.version).toBeString();
      expect(body.uptime).toBeNumber();
      expect(body.uptime as number).toBeGreaterThanOrEqual(0);
    }));
});

describe('Server /session', () => {
  test('POST /session creates a session and returns 201', () =>
    withServer(async (inst) => {
      const res = await fetch(url(inst, '/session'), { method: 'POST' });
      expect(res.status).toBe(201);

      const body = (await res.json()) as JsonBody;
      expect(body.sessionId).toBeString();
      expect(String(body.sessionId)).toMatch(/^ses_/);
    }));

  test('GET /session/:id returns session info', () =>
    withServer(async (inst) => {
      const createRes = await fetch(url(inst, '/session'), { method: 'POST' });
      const createBody = (await createRes.json()) as { sessionId: string };
      const sessionId = createBody.sessionId;

      const getRes = await fetch(url(inst, `/session/${sessionId}`));
      expect(getRes.status).toBe(200);

      const body = (await getRes.json()) as JsonBody;
      expect(body.sessionId).toBe(sessionId);
      expect(body.status).toBe('active');
      expect(body.createdAt).toBeString();
    }));

  test('GET /session/:id returns 404 for unknown session', () =>
    withServer(async (inst) => {
      const res = await fetch(url(inst, '/session/nonexistent'));
      expect(res.status).toBe(404);

      const body = (await res.json()) as JsonBody;
      expect(body.error).toBe('session_not_found');
    }));
});

// ─── SSE routing tests (unit-level — handler called directly) ─

// Bun's test fetch() blocks on streaming response body completion,
// so SSE endpoint routing is tested by calling createFetchHandler directly.

describe('Server /events (SSE) — route handler', () => {
  test('GET /events without sessionId returns 400', async () => {
    const hub = new SSEHub();
    const sessions = new Map<string, SessionInfo>();
    const handler = createFetchHandler(hub, sessions);

    const res = callHandler(handler, makeReq('/events'));
    expect(res.status).toBe(400);

    const body = (await res.json()) as JsonBody;
    expect(body.error).toBe('missing_sessionId');
  });

  test('GET /events with unknown sessionId returns 404', async () => {
    const hub = new SSEHub();
    const sessions = new Map<string, SessionInfo>();
    const handler = createFetchHandler(hub, sessions);

    const res = callHandler(handler, makeReq('/events?sessionId=unknown'));
    expect(res.status).toBe(404);

    const body = (await res.json()) as JsonBody;
    expect(body.error).toBe('session_not_found');
  });

  test('GET /events with valid sessionId returns SSE stream response', () => {
    const hub = new SSEHub();
    const sessions = new Map<string, SessionInfo>();
    sessions.set('ses_test', {
      sessionId: 'ses_test',
      createdAt: new Date().toISOString(),
      status: 'active',
    });
    const handler = createFetchHandler(hub, sessions);

    const res = callHandler(handler, makeReq('/events?sessionId=ses_test'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Connection')).toBe('keep-alive');
    expect(res.headers.get('X-Session-Id')).toBe('ses_test');
  });

  test('SSE endpoint creates a subscriber in the hub', () => {
    const hub = new SSEHub();
    const sessions = new Map<string, SessionInfo>();
    sessions.set('ses_test', {
      sessionId: 'ses_test',
      createdAt: new Date().toISOString(),
      status: 'active',
    });
    const handler = createFetchHandler(hub, sessions);

    expect(hub.sessionCount).toBe(0);
    callHandler(handler, makeReq('/events?sessionId=ses_test'));
    expect(hub.sessionCount).toBe(1);
  });
});

// ─── SSE integration: SSEHub + HTTP handler ──────────────────

describe('Server /events (SSE) — hub integration', () => {
  test('broadcast to session after SSE subscribe succeeds', () => {
    const hub = new SSEHub();
    const sessions = new Map<string, SessionInfo>();
    sessions.set('ses_test', {
      sessionId: 'ses_test',
      createdAt: new Date().toISOString(),
      status: 'active',
    });
    const handler = createFetchHandler(hub, sessions);

    callHandler(handler, makeReq('/events?sessionId=ses_test'));
    expect(hub.sessionCount).toBe(1);

    // Broadcast should not throw.
    hub.broadcast('ses_test', {
      type: 'tool.progress',
      callId: 'c1',
      message: 'hello',
    });

    hub.closeAll();
  });

  test('terminal event closes subscriber added via SSE endpoint', () => {
    const hub = new SSEHub();
    const sessions = new Map<string, SessionInfo>();
    sessions.set('ses_test', {
      sessionId: 'ses_test',
      createdAt: new Date().toISOString(),
      status: 'active',
    });
    const handler = createFetchHandler(hub, sessions);

    callHandler(handler, makeReq('/events?sessionId=ses_test'));
    expect(hub.sessionCount).toBe(1);

    hub.broadcast('ses_test', { type: 'session.idle', sessionId: 'ses_test' });
    expect(hub.sessionCount).toBe(0);
  });
});

// ─── Server lifecycle ────────────────────────────────────────

describe('Server lifecycle', () => {
  test('server close stops accepting new connections', async () => {
    const inst = createServer({ port: 0 });
    const addr = inst.server;

    const res = await fetch(url(inst, '/health'));
    expect(res.status).toBe(200);

    inst.close();

    try {
      await fetch(`http://${addr.hostname}:${addr.port}/health`);
      expect.unreachable('Expected fetch to fail after server close');
    } catch {
      // Expected.
    }
  });

  test('close cleans up all SSE sessions', () => {
    const inst = createServer({ port: 0 });
    inst.sseHub.subscribe('ses_A');
    inst.sseHub.subscribe('ses_B');
    expect(inst.sseHub.sessionCount).toBe(2);

    inst.close();
    expect(inst.sseHub.sessionCount).toBe(0);
  });
});

describe('Server 404', () => {
  test('unknown route returns 404', () =>
    withServer(async (inst) => {
      const res = await fetch(url(inst, '/unknown'));
      expect(res.status).toBe(404);

      const body = (await res.json()) as JsonBody;
      expect(body.error).toBe('not_found');
    }));
});
