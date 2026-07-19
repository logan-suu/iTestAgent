/**
 * phase1-server-routes.test.ts — Integration test for HTTP server routing.
 *
 * Cross-package: Bun.serve → createFetchHandler → SessionManager → SSEHub → RSM
 * Single server shared across all tests in this describe block.
 * SSE tests use AbortController to close streams cleanly.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStateMachine } from 'itestagent-engine';
import { SSEHub, SessionManager, createFetchHandler, createServer } from 'itestagent-server';
import type { ServerInstance } from 'itestagent-server';
import { createDb, createStoreDriver, initStore } from 'itestagent-store';

let server: ServerInstance;
let storeRoot: string;
let baseUrl: string;

beforeAll(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), 'itestagent-routes-'));
  initStore(storeRoot);
  const dbPath = join(storeRoot, 'db', 'itestagent.db');
  const storeDriver = createStoreDriver(dbPath);
  const db = createDb(dbPath);
  await storeDriver.migrate();
  const sseHub = new SSEHub();
  const sm = new SessionManager({ sseHub, db, runStateMachine: new RunStateMachine() });
  server = createServer({}, { sseHub, sessionManager: sm });
  baseUrl = `http://${server.server.hostname}:${server.server.port}`;
});

afterAll(() => {
  server.close();
  rmSync(storeRoot, { recursive: true, force: true });
});

describe('Phase 1 Integration: Server Routes (Bun.serve → Routes → SessionManager)', () => {
  test('GET /health → 200', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.0.1');
    expect(typeof body.uptime).toBe('number');
  });

  test('POST /session → 201 with SessionInfo', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: '/tmp/test', targetKind: 'physical' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.sessionId).toStartWith('ses_');
    expect(body.runId).toStartWith('run_');
    expect(body.status).toBe('active');
  });

  test('POST /session missing workspace → 400', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKind: 'physical' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /session invalid targetKind → 400', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: '/tmp/x', targetKind: 'android' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /session empty body → 400', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(400);
  });

  test('POST /session simulator targetKind → 201', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: '/tmp/sim', targetKind: 'simulator' }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Record<string, unknown>).targetKind).toBe('simulator');
  });

  test('POST /session with optional backend → 201', async () => {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: '/tmp/test', targetKind: 'physical', backend: 'appium' }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Record<string, unknown>).backend).toBe('appium');
  });

  test('GET /session/:id → 200 for valid session', async () => {
    const c = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: '/tmp/test', targetKind: 'physical' }),
    });
    const { sessionId } = (await c.json()) as Record<string, string>;
    const res = await fetch(`${baseUrl}/session/${sessionId}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).sessionId).toBe(sessionId);
  });

  test('GET /session/:id → 404 for unknown', async () => {
    const res = await fetch(`${baseUrl}/session/ses_nonexistent`);
    expect(res.status).toBe(404);
  });

  test('GET /events without sessionId → 400', async () => {
    const res = await fetch(`${baseUrl}/events`);
    expect(res.status).toBe(400);
  });

  test('GET /events unknown sessionId → 404', async () => {
    const res = await fetch(`${baseUrl}/events?sessionId=ses_nonexistent`);
    expect(res.status).toBe(404);
  });

  test('Unknown route → 404', async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });

  test('GET /events?sessionId= returns SSE response with text/event-stream content-type', async () => {
    const c = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: '/tmp/test', targetKind: 'physical' }),
    });
    const { sessionId } = (await c.json()) as Record<string, string>;

    const handler = createFetchHandler(server.sseHub, server.sessionManager);
    const req = new Request(`http://localhost/events?sessionId=${sessionId}`);
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-session-id')).toBe(sessionId ?? null);
  });
});
