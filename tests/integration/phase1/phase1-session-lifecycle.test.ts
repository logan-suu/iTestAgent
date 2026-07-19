/**
 * phase1-session-lifecycle.test.ts — Integration test for the core state chain.
 *
 * Cross-package chain: SSEHub → SessionManager → RunStateMachine
 * Uses the real RunStateMachine + SSEHub. DB is mocked (SessionManager
 * fires DB ops without await — deferred to DEF-001, Phase 3).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableName } from 'drizzle-orm';
import type { AgentEvent } from 'itestagent-contracts';
import { RunStateMachine } from 'itestagent-engine';
import { SSEHub, SessionManager } from 'itestagent-server';
import { createDb, createStoreDriver, initStore, schema } from 'itestagent-store';

// ─── Mock DbClient (matches session-manager.test.ts pattern) ─

function createMockDb() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};

  // biome-ignore lint/suspicious/noExplicitAny: mock handles untyped Drizzle objects
  function resolveName(t: any): string {
    try {
      return getTableName(t);
    } catch {
      return t?.config?.name ?? String(t);
    }
  }

  function getOrCreate(name: string) {
    if (!tables[name]) tables[name] = new Map();
    // biome-ignore lint/style/noNonNullAssertion: table just created above
    return tables[name]!;
  }

  return {
    _tables: tables,

    insert(t: unknown) {
      const tbl = getOrCreate(resolveName(t));
      return {
        values(data: Record<string, unknown>) {
          const key = String(data.id ?? data.runId ?? data.projectHash ?? Bun.randomUUIDv7());
          tbl.set(key, { ...data });
          const thenable = Promise.resolve(data) as Promise<unknown> & {
            onConflictDoNothing: () => Promise<unknown>;
          };
          thenable.onConflictDoNothing = () => Promise.resolve(data);
          return thenable;
        },
      };
    },

    // biome-ignore lint/suspicious/noExplicitAny: mock
    update(t: any) {
      const tbl = getOrCreate(resolveName(t));
      return {
        set(data: Record<string, unknown>) {
          const thenable = Promise.resolve(undefined) as Promise<unknown> & {
            where: (c: unknown) => Promise<unknown>;
          };
          thenable.where = (_cond: unknown) => {
            for (const r of tbl.values()) Object.assign(r, data);
            return Promise.resolve(undefined);
          };
          return thenable;
        },
      };
    },
  };
}

// ─── Suite ──────────────────────────────────────────────────

describe('Phase 1 Integration: Session Lifecycle (SSEHub → SessionManager → RSM)', () => {
  let sseHub: SSEHub;
  let rsm: RunStateMachine;
  let mockDb: ReturnType<typeof createMockDb>;
  let sm: SessionManager;

  beforeEach(() => {
    sseHub = new SSEHub();
    rsm = new RunStateMachine();
    mockDb = createMockDb();
    // biome-ignore lint/suspicious/noExplicitAny: mock DbClient — SessionManager requires Drizzle db
    sm = new SessionManager({ sseHub, db: mockDb as any, runStateMachine: rsm });
  });

  test('createSession returns valid SessionInfo and triggers DB inserts', () => {
    const session = sm.createSession({
      workspace: '/tmp/test',
      targetKind: 'physical',
      backend: 'appium',
    });
    expect(session.sessionId).toStartWith('ses_');
    expect(session.runId).toStartWith('run_');
    expect(session.targetKind).toBe('physical');
    expect(session.backend).toBe('appium');
    expect(session.status).toBe('active');

    const projectsTbl = mockDb._tables.projects;
    expect(projectsTbl).toBeDefined();
    expect(projectsTbl?.size).toBeGreaterThanOrEqual(1);

    const runsTbl = mockDb._tables.runs;
    expect(runsTbl).toBeDefined();
    expect(runsTbl?.size).toBeGreaterThanOrEqual(1);
    // biome-ignore lint/style/noNonNullAssertion: asserted .toBeDefined() above
    const runVals = [...runsTbl!.values()];
    expect(runVals.some((r) => r.status === 'created')).toBe(true);
  });

  test('closeSession updates DB and cleans SSE', async () => {
    const session = sm.createSession({ workspace: '/tmp/test', targetKind: 'simulator' });
    const reader = sseHub.subscribe(session.sessionId).getReader();

    sm.closeSession(session.sessionId);
    expect(sm.getSession(session.sessionId)).toBeUndefined();

    // biome-ignore lint/style/noNonNullAssertion: asserted .toBeDefined() via .has() check
    const runsTbl = mockDb._tables.runs!;
    const runVals = [...runsTbl.values()];
    expect(runVals.some((r) => r.status === 'cancelled')).toBe(true);

    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  test('closeSession is idempotent', () => {
    const s = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });
    sm.closeSession(s.sessionId);
    sm.closeSession(s.sessionId);
    expect(sm.getSession(s.sessionId)).toBeUndefined();
  });

  test('SSE events are isolated per session', async () => {
    const sA = sm.createSession({ workspace: '/tmp/a', targetKind: 'physical' });
    const sB = sm.createSession({ workspace: '/tmp/b', targetKind: 'simulator' });
    const rA = sseHub.subscribe(sA.sessionId).getReader();
    const rB = sseHub.subscribe(sB.sessionId).getReader();

    sseHub.broadcast(sA.sessionId, {
      type: 'session.started',
      sessionId: sA.sessionId,
      runId: sA.runId,
    } as unknown as AgentEvent);

    const a = await rA.read();
    expect(a.done).toBe(false);
    expect(new TextDecoder().decode(a.value)).toContain(sA.sessionId);

    const timeout = new Promise<'t'>((r) => setTimeout(() => r('t'), 100));
    expect(await Promise.race([rB.read(), timeout])).toBe('t');
    rA.releaseLock();
    rB.releaseLock();
  });

  test('getSession resets idle timer', async () => {
    const short = new SessionManager({
      sseHub: new SSEHub(),
      // biome-ignore lint/suspicious/noExplicitAny: mock DbClient
      db: createMockDb() as any,
      runStateMachine: new RunStateMachine(),
      idleTimeoutMs: 100,
    });
    const s = short.createSession({ workspace: '/tmp/x', targetKind: 'physical' });
    await new Promise((r) => setTimeout(r, 50));
    expect(short.getSession(s.sessionId)).toBeDefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(short.getSession(s.sessionId)).toBeDefined();
    await new Promise((r) => setTimeout(r, 150));
    expect(short.getSession(s.sessionId)).toBeUndefined();
  });

  test('listSessions and sessionCount', () => {
    expect(sm.sessionCount).toBe(0);
    const s1 = sm.createSession({ workspace: '/tmp/a', targetKind: 'physical' });
    expect(sm.sessionCount).toBe(1);
    sm.createSession({ workspace: '/tmp/b', targetKind: 'simulator' });
    expect(sm.sessionCount).toBe(2);
    sm.closeSession(s1.sessionId);
    expect(sm.sessionCount).toBe(1);
  });

  test('closeAll', () => {
    sm.createSession({ workspace: '/tmp/a', targetKind: 'physical' });
    sm.createSession({ workspace: '/tmp/b', targetKind: 'simulator' });
    expect(sm.sessionCount).toBe(2);
    sm.closeAll();
    expect(sm.sessionCount).toBe(0);
  });

  test('getSession returns undefined for unknown id', () => {
    expect(sm.getSession('ses_nonexistent')).toBeUndefined();
  });

  test('RSM forward chain: created→planning→awaiting_confirm→preparing_device', () => {
    const s = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });
    expect(rsm.transition(s.runId, 'created', 'planning')).toBe('planning');
    expect(rsm.transition(s.runId, 'planning', 'awaiting_confirm')).toBe('awaiting_confirm');
  });

  test('RSM cancel and pause/resume', () => {
    const s = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });
    rsm.transition(s.runId, 'created', 'planning');
    expect(rsm.cancel(s.runId, 'planning')).toBe('cancelled');
  });

  test('RSM pause→blocked→resume→awaiting_confirm', () => {
    const s = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });
    rsm.transition(s.runId, 'created', 'planning');
    expect(rsm.pause(s.runId, 'planning')).toBe('blocked');
    expect(rsm.isPaused(s.runId)).toBe(true);
    expect(rsm.resume(s.runId)).toBe('awaiting_confirm');
    expect(rsm.isPaused(s.runId)).toBe(false);
  });

  test('RSM invalid transition throws', () => {
    const s = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });
    expect(() => rsm.transition(s.runId, 'created', 'executing')).toThrow('Invalid transition');
  });

  test('RSM terminal→done is valid, terminal→forward is not', () => {
    const s = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });
    expect(rsm.cancel(s.runId, 'created')).toBe('cancelled');
    expect(rsm.transition(s.runId, 'cancelled', 'done')).toBe('done');
    expect(() => rsm.transition(s.runId, 'done', 'created')).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════
// Real DB persistence (verifies .catch() triggers SQL execution)
// ═══════════════════════════════════════════════════════════

describe('Phase 1 Integration: Real DB Persistence (SessionManager → SQLite)', () => {
  let storeRoot: string;

  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), 'itestagent-db-'));
    initStore(storeRoot);
  });

  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  test('createSession persists project + run to real SQLite', async () => {
    const dbPath = join(storeRoot, 'db', 'itestagent.db');
    const storeDriver = createStoreDriver(dbPath);
    await storeDriver.migrate();
    const db = createDb(dbPath);

    const sm = new SessionManager({
      sseHub: new SSEHub(),
      db,
      runStateMachine: new RunStateMachine(),
    });

    sm.createSession({ workspace: '/tmp/test', targetKind: 'physical', backend: 'appium' });

    await new Promise((r) => setTimeout(r, 200));

    const projectRows = db.select().from(schema.projects).all();
    expect(projectRows.length).toBe(1);
    expect(projectRows[0]?.workspacePath).toBe('/tmp/test');

    const runRows = db.select().from(schema.runs).all();
    expect(runRows.length).toBe(1);
    expect(runRows[0]?.status).toBe('created');
    expect(runRows[0]?.targetKind).toBe('physical');
  });

  test('closeSession updates run status to cancelled in real SQLite', async () => {
    const dbPath = join(storeRoot, 'db', 'itestagent.db');
    const storeDriver = createStoreDriver(dbPath);
    await storeDriver.migrate();
    const db = createDb(dbPath);

    const sm = new SessionManager({
      sseHub: new SSEHub(),
      db,
      runStateMachine: new RunStateMachine(),
    });

    const session = sm.createSession({ workspace: '/tmp/test', targetKind: 'simulator' });

    await new Promise((r) => setTimeout(r, 200));

    sm.closeSession(session.sessionId);

    await new Promise((r) => setTimeout(r, 200));

    const runRows = db.select().from(schema.runs).all();
    expect(runRows.length).toBe(1);
    expect(runRows[0]?.status).toBe('cancelled');
  });
});
