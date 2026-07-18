import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { RunState } from 'itestagent-contracts';
import type { RunStateMachine } from 'itestagent-engine';
import * as storeSchema from 'itestagent-store';

import { createFetchHandler } from '../src/routes.js';
import { type ServerInstance, createServer } from '../src/server.js';
import { SessionManager } from '../src/session-manager.js';
import { SSEHub } from '../src/sse-hub.js';
import type { SessionInfo } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────

/** JSON body shape for generic responses. */
type JsonBody = Record<string, unknown>;

function url(instance: ServerInstance, path: string): string {
  const addr = instance.server;
  return `http://${addr.hostname}:${addr.port}${path}`;
}

/** Create a real in-memory SQLite DbClient — no mocks, no casts. */
function makeDbClient() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA journal_mode = WAL');
  sqlite.run('PRAGMA foreign_keys = ON');
  return drizzle(sqlite, { schema: storeSchema.schema });
}

/** Minimal mock RunStateMachine — object literal, no class instantiation. */
const mockRunStateMachine = {
  start(_runId: string): RunState {
    return 'created';
  },
  cancel(_runId: string, _from: RunState, _reason?: string): RunState {
    return 'cancelled';
  },
} as unknown as RunStateMachine;

/** Create SessionManager backed by real in-memory DB and mock RSM. */
function makeSessionManager(sseHub: SSEHub): SessionManager {
  return new SessionManager({
    sseHub,
    db: makeDbClient(),
    runStateMachine: mockRunStateMachine,
    idleTimeoutMs: 60_000, // Short timeout so idle tests don't hang.
  });
}

/**
 * Create a server, run the test, then ensure cleanup.
 * All deps (SSEHub + SessionManager) are created automatically.
 */
async function withServer<T>(fn: (inst: ServerInstance) => Promise<T>): Promise<T> {
  const sseHub = new SSEHub();
  const sessionManager = makeSessionManager(sseHub);
  const inst = createServer({ port: 0 }, { sseHub, sessionManager });
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
      const res = await fetch(url(inst, '/session'), {
        method: 'POST',
        body: JSON.stringify({ workspace: '/test', targetKind: 'physical' }),
      });
      expect(res.status).toBe(201);

      const body = (await res.json()) as JsonBody;
      expect(body.sessionId).toBeString();
      expect(String(body.sessionId)).toMatch(/^ses_/);
      expect(body.workspace).toBe('/test');
      expect(body.targetKind).toBe('physical');
      expect(body.status).toBe('active');
    }));

  test('GET /session/:id returns session info', () =>
    withServer(async (inst) => {
      const createRes = await fetch(url(inst, '/session'), {
        method: 'POST',
        body: JSON.stringify({ workspace: '/test', targetKind: 'simulator' }),
      });
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

  test('POST /session without body returns 400', () =>
    withServer(async (inst) => {
      const res = await fetch(url(inst, '/session'), { method: 'POST' });
      expect(res.status).toBe(400);

      const body = (await res.json()) as JsonBody;
      expect(body.error).toBe('invalid_request');
    }));

  test('POST /session with invalid targetKind returns 400', () =>
    withServer(async (inst) => {
      const res = await fetch(url(inst, '/session'), {
        method: 'POST',
        body: JSON.stringify({ workspace: '/test', targetKind: 'invalid' }),
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as JsonBody;
      expect(body.error).toBe('invalid_request');
    }));
});

// ─── SSE routing tests (unit-level — handler called directly) ─

// Bun's test fetch() blocks on streaming response body completion,
// so SSE endpoint routing is tested by calling createFetchHandler directly.

describe('Server /events (SSE) — route handler', () => {
  function makeHandler(): ReturnType<typeof createFetchHandler> {
    const hub = new SSEHub();
    const sessionManager = makeSessionManager(hub);
    return createFetchHandler(hub, sessionManager);
  }

  test('GET /events without sessionId returns 400', async () => {
    const handler = makeHandler();
    const res = callHandler(handler, makeReq('/events'));
    expect(res.status).toBe(400);

    const body = (await res.json()) as JsonBody;
    expect(body.error).toBe('missing_sessionId');
  });

  test('GET /events with unknown sessionId returns 404', async () => {
    const handler = makeHandler();
    const res = callHandler(handler, makeReq('/events?sessionId=unknown'));
    expect(res.status).toBe(404);

    const body = (await res.json()) as JsonBody;
    expect(body.error).toBe('session_not_found');
  });

  test('GET /events with valid sessionId returns SSE stream response', () => {
    const hub = new SSEHub();
    const sessionManager = makeSessionManager(hub);
    // Create a session in SessionManager so getSession() resolves.
    const session = sessionManager.createSession({
      workspace: '/test',
      targetKind: 'physical',
    });
    const handler = createFetchHandler(hub, sessionManager);

    const res = callHandler(handler, makeReq(`/events?sessionId=${session.sessionId}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Connection')).toBe('keep-alive');
    expect(res.headers.get('X-Session-Id')).toBe(session.sessionId);
  });

  test('SSE endpoint creates a subscriber in the hub', () => {
    const hub = new SSEHub();
    const sessionManager = makeSessionManager(hub);
    const session = sessionManager.createSession({
      workspace: '/test',
      targetKind: 'physical',
    });
    const handler = createFetchHandler(hub, sessionManager);

    expect(hub.sessionCount).toBe(0);
    callHandler(handler, makeReq(`/events?sessionId=${session.sessionId}`));
    expect(hub.sessionCount).toBe(1);
  });
});

// ─── SSE integration: SSEHub + HTTP handler ──────────────────

describe('Server /events (SSE) — hub integration', () => {
  test('broadcast to session after SSE subscribe succeeds', () => {
    const hub = new SSEHub();
    const sessionManager = makeSessionManager(hub);
    const session = sessionManager.createSession({
      workspace: '/test',
      targetKind: 'physical',
    });
    const handler = createFetchHandler(hub, sessionManager);

    callHandler(handler, makeReq(`/events?sessionId=${session.sessionId}`));
    expect(hub.sessionCount).toBe(1);

    // Broadcast should not throw.
    hub.broadcast(session.sessionId, {
      type: 'tool.progress',
      callId: 'c1',
      message: 'hello',
    });

    hub.closeAll();
  });

  test('terminal event closes subscriber added via SSE endpoint', () => {
    const hub = new SSEHub();
    const sessionManager = makeSessionManager(hub);
    const session = sessionManager.createSession({
      workspace: '/test',
      targetKind: 'physical',
    });
    const handler = createFetchHandler(hub, sessionManager);

    callHandler(handler, makeReq(`/events?sessionId=${session.sessionId}`));
    expect(hub.sessionCount).toBe(1);

    hub.broadcast(session.sessionId, { type: 'session.idle', sessionId: session.sessionId });
    expect(hub.sessionCount).toBe(0);
  });
});

// ─── Server lifecycle ────────────────────────────────────────

describe('Server lifecycle', () => {
  test('server close stops accepting new connections', async () => {
    const inst = createServer(
      { port: 0 },
      {
        sseHub: new SSEHub(),
        sessionManager: makeSessionManager(new SSEHub()),
      },
    );
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
    const sseHub = new SSEHub();
    const inst = createServer(
      { port: 0 },
      {
        sseHub,
        sessionManager: makeSessionManager(sseHub),
      },
    );
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
