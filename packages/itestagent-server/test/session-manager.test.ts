import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getTableName } from 'drizzle-orm';
import { SSEHub } from '../src/sse-hub.js';
import type { SessionInfo } from '../src/types.js';

// ─── Mock Factories ───────────────────────────────────────────

/**
 * Mock RunStateMachine that tracks state transitions in memory.
 *
 * Methods mirror the real RunStateMachine:
 *   - start(runId) → 'created'
 *   - transition(runId, from, to, reason?) → to
 *   - cancel(runId, from, reason?) → 'cancelled'
 *   - cleanup(runId) → void
 *
 * Internal `_calls` array records every invocation for test assertions.
 */
function createMockRunStateMachine() {
  const states = new Map<string, string>();
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    _states: states,
    _calls: calls,

    start(runId: string): string {
      calls.push({ method: 'start', args: [runId] });
      states.set(runId, 'created');
      return 'created';
    },

    transition(runId: string, from: string, to: string, reason?: string): string {
      calls.push({ method: 'transition', args: [runId, from, to, reason] });
      states.set(runId, to);
      return to;
    },

    cancel(runId: string, from: string, reason?: string): string {
      calls.push({ method: 'cancel', args: [runId, from, reason] });
      return this.transition(runId, from, 'cancelled', reason ?? 'cancelled');
    },

    cleanup(runId: string): void {
      calls.push({ method: 'cleanup', args: [runId] });
      states.delete(runId);
    },
  };
}

/**
 * Mock Drizzle DbClient backed by in-memory Maps keyed by table name.
 *
 * Supported operations:
 *   - insert(table).values(data).onConflictDoNothing() → stores record
 *   - update(table).set(data).where(condition) → mutates all records in the table
 *   - select().from(table).where(condition) → returns Promise<record[]>
 *   - transaction(fn) → executes fn with `this` as tx
 *
 * Table names are extracted from the Drizzle config (`table.config.name`)
 * or fall back to the string representation.
 */
function createMockDb() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};

  // biome-ignore lint/suspicious/noExplicitAny: mock handles untyped Drizzle objects
  function resolveName(t: any): string {
    try {
      return getTableName(t);
    } catch {
      // Fallback for non-Drizzle table objects.
      return t?.config?.name ?? String(t);
    }
  }

  function getOrCreate(name: string): Map<string, Record<string, unknown>> {
    if (!tables[name]) tables[name] = new Map();
    return tables[name];
  }

  const db = {
    /** Internal table storage for test assertions. */
    _tables: tables,

    insert(t: unknown) {
      const tbl = getOrCreate(resolveName(t));
      return {
        values(data: Record<string, unknown>) {
          const key = (data.id ?? data.runId ?? data.projectHash) as string;
          tbl.set(String(key), { ...data });
          const thenable = Promise.resolve(data) as Promise<unknown> & {
            onConflictDoNothing: () => Promise<unknown>;
          };
          thenable.onConflictDoNothing = () => Promise.resolve(data);
          return thenable;
        },
      };
    },

    // biome-ignore lint/suspicious/noExplicitAny: mock handles untyped Drizzle objects
    select(..._fields: any[]) {
      return {
        // biome-ignore lint/suspicious/noExplicitAny: mock handles untyped Drizzle objects
        from(t: any) {
          const tbl = getOrCreate(resolveName(t));
          return {
            where(_condition: unknown) {
              return Promise.resolve([...tbl.values()]);
            },
          };
        },
      };
    },

    update(t: unknown) {
      const tbl = getOrCreate(resolveName(t));
      return {
        set(data: Record<string, unknown>) {
          const thenable = Promise.resolve(undefined) as Promise<unknown> & {
            where: (c: unknown) => Promise<unknown>;
          };
          thenable.where = (_condition: unknown) => {
            for (const record of tbl.values()) {
              Object.assign(record, data);
            }
            return Promise.resolve(undefined);
          };
          return thenable;
        },
      };
    },

    // biome-ignore lint/suspicious/noExplicitAny: mock handles untyped Drizzle objects
    transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };

  return db;
}

// ─── SessionManager import ────────────────────────────────────

import { SessionManager } from '../src/session-manager.js';

// ─── Helpers ──────────────────────────────────────────────────

/** Shallow clone to avoid reference-mutated records in assertions. */
function cloneRunRecords(
  tables: Record<string, Map<string, Record<string, unknown>>>,
): Record<string, unknown>[] {
  const runs = tables.runs;
  if (!runs) return [];
  return [...runs.values()].map((r) => ({ ...r }));
}

/** Count default values. */
function countSessionsWithStatus(list: SessionInfo[], status: string): number {
  return list.filter((s) => s.status === status).length;
}

// ─── Tests ───────────────────────────────────────────────────

describe('SessionManager', () => {
  let sseHub: SSEHub;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockRSM: ReturnType<typeof createMockRunStateMachine>;
  let manager: SessionManager;

  beforeEach(() => {
    sseHub = new SSEHub();
    mockDb = createMockDb();
    mockRSM = createMockRunStateMachine();
    manager = new SessionManager({
      sseHub,
      // biome-ignore lint/suspicious/noExplicitAny: test mock typed differently from production DbClient
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock typed differently from RunStateMachine
      runStateMachine: mockRSM as any,
    });
  });

  afterEach(() => {
    manager.closeAll();
  });

  // ── createSession ─────────────────────────────────────────

  describe('createSession({ workspace, targetKind })', () => {
    test('returns SessionInfo with ses_ prefix, run_ prefix, all fields populated', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      expect(session.sessionId).toMatch(/^ses_/);
      expect(session.runId).toMatch(/^run_/);
      expect(session.workspace).toBe('/test/project');
      expect(session.targetKind).toBe('physical');
      expect(session.status).toBe('active');
      expect(session.createdAt).toBeString();
      // Verify valid ISO-8601
      expect(new Date(session.createdAt).toISOString()).toBe(session.createdAt);
    });

    test('generates unique sessionId and runId per call', () => {
      const s1 = manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      const s2 = manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });

      expect(s1.sessionId).not.toBe(s2.sessionId);
      expect(s1.runId).not.toBe(s2.runId);
    });

    test('persists project and run records via db mock', () => {
      manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      const projects = mockDb._tables.projects;
      const runs = mockDb._tables.runs;

      expect(projects).toBeDefined();
      expect(projects?.size).toBe(1);
      expect(runs).toBeDefined();
      expect(runs?.size).toBe(1);

      const project = projects ? [...projects.values()][0] : undefined;
      expect(project).toBeDefined();
      expect(project?.workspacePath).toBe('/test/project');
      expect(project?.projectHash).toBeString();
    });

    test('calls runStateMachine.start(runId)', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      const startCalls = mockRSM._calls.filter((c) => c.method === 'start');
      expect(startCalls.length).toBe(1);
      expect(startCalls[0]?.args[0]).toBe(session.runId);
    });

    test('run record status defaults to created', () => {
      manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      const runs = cloneRunRecords(mockDb._tables);
      expect(runs.length).toBe(1);
      expect(runs[0]?.status).toBe('created');
    });

    test('with targetKind: "simulator" works', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'simulator',
      });

      expect(session.targetKind).toBe('simulator');
    });

    test('persists targetKind in the run record', () => {
      manager.createSession({
        workspace: '/test/project',
        targetKind: 'simulator',
      });

      const runs = cloneRunRecords(mockDb._tables);
      expect(runs[0]?.targetKind).toBe('simulator');
    });

    test('with optional backend stores it in SessionInfo', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
        backend: 'appium',
      });

      expect(session.backend).toBe('appium');
    });

    test('backend defaults to undefined when omitted', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      expect(session.backend).toBeUndefined();
    });

    test('persists backend in the run record when provided', () => {
      manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
        backend: 'mobile-mcp',
      });

      const runs = cloneRunRecords(mockDb._tables);
      expect(runs[0]?.backend).toBe('mobile-mcp');
    });

    test('createSession should not subscribe to SSE (subscription happens at /events endpoint)', () => {
      manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      // SSEHub sessionCount tracks subscribers, not sessions.
      expect(sseHub.sessionCount).toBe(0);
    });
  });

  // ── getSession ────────────────────────────────────────────

  describe('getSession(sessionId)', () => {
    test('returns session when found', () => {
      const created = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      const found = manager.getSession(created.sessionId);
      expect(found).toBeDefined();
      expect(found?.sessionId).toBe(created.sessionId);
      expect(found?.runId).toBe(created.runId);
      expect(found?.workspace).toBe(created.workspace);
    });

    test('returns undefined for unknown sessionId', () => {
      expect(manager.getSession('ses_nonexistent')).toBeUndefined();
    });

    test('returns undefined for a closed session', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      manager.closeSession(session.sessionId);

      expect(manager.getSession(session.sessionId)).toBeUndefined();
    });
  });

  // ── closeSession ──────────────────────────────────────────

  describe('closeSession(sessionId)', () => {
    test('calls runStateMachine.cancel() with the runId', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      manager.closeSession(session.sessionId);

      const cancelCalls = mockRSM._calls.filter((c) => c.method === 'cancel');
      expect(cancelCalls.length).toBe(1);
      expect(cancelCalls[0]?.args[0]).toBe(session.runId);
    });

    test('passes current run state as "from" to cancel', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      manager.closeSession(session.sessionId);

      const cancelCall = mockRSM._calls.find((c) => c.method === 'cancel');
      // After start(), the state is 'created'
      expect(cancelCall?.args[1]).toBe('created');
    });

    test('removes session from the internal map', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      manager.closeSession(session.sessionId);

      expect(manager.getSession(session.sessionId)).toBeUndefined();
    });

    test('is idempotent — calling twice does not throw', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      manager.closeSession(session.sessionId);
      expect(() => manager.closeSession(session.sessionId)).not.toThrow();
    });

    test('is idempotent — cancel called only once', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      manager.closeSession(session.sessionId);
      manager.closeSession(session.sessionId);

      const cancelCalls = mockRSM._calls.filter((c) => c.method === 'cancel');
      expect(cancelCalls.length).toBe(1);
    });

    test('with unknown sessionId does not throw', () => {
      expect(() => manager.closeSession('ses_unknown')).not.toThrow();
    });

    test('updates the run record status to cancelled in db', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      manager.closeSession(session.sessionId);

      const runs = cloneRunRecords(mockDb._tables);
      const run = runs.find((r) => r.runId === session.runId);
      expect(run).toBeDefined();
      expect(run?.status).toBe('cancelled');
    });

    test('cleans SSE subscribers for the session', () => {
      const session = manager.createSession({
        workspace: '/test/project',
        targetKind: 'physical',
      });

      // Simulate an SSE subscriber attaching via the HTTP endpoint
      sseHub.subscribe(session.sessionId);
      expect(sseHub.sessionCount).toBe(1);

      manager.closeSession(session.sessionId);

      expect(sseHub.sessionCount).toBe(0);
    });
  });

  // ── listSessions ──────────────────────────────────────────

  describe('listSessions()', () => {
    test('returns empty array when no sessions exist', () => {
      expect(manager.listSessions()).toEqual([]);
    });

    test('returns array of active SessionInfo objects', () => {
      const s1 = manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      const s2 = manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });

      const list = manager.listSessions();
      expect(list.length).toBe(2);
      const ids = list.map((s) => s.sessionId).sort();
      expect(ids).toEqual([s1.sessionId, s2.sessionId].sort());
    });

    test('closed sessions are excluded from the list', () => {
      const s1 = manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      manager.createSession({
        workspace: '/test/b',
        targetKind: 'physical',
      });

      manager.closeSession(s1.sessionId);

      expect(manager.listSessions().length).toBe(1);
    });

    test('all returned sessions have status "active"', () => {
      manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });

      const activeCount = countSessionsWithStatus(manager.listSessions(), 'active');
      expect(activeCount).toBe(2);
    });
  });

  // ── closeAll ──────────────────────────────────────────────

  describe('closeAll()', () => {
    test('closes all sessions without throwing', () => {
      manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });

      expect(() => manager.closeAll()).not.toThrow();
      expect(manager.listSessions().length).toBe(0);
    });

    test('closeAll on empty manager does not throw', () => {
      expect(() => manager.closeAll()).not.toThrow();
    });

    test('calls cancel for every active session', () => {
      manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });
      manager.createSession({
        workspace: '/test/c',
        targetKind: 'physical',
      });

      manager.closeAll();

      const cancelCalls = mockRSM._calls.filter((c) => c.method === 'cancel');
      expect(cancelCalls.length).toBe(3);
    });

    test('after closeAll, sessionCount is zero', () => {
      manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });

      manager.closeAll();

      expect(manager.sessionCount).toBe(0);
    });
  });

  // ── Session isolation ─────────────────────────────────────

  describe('Session isolation', () => {
    test('two sessions have different runIds and independent state', () => {
      const s1 = manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      const s2 = manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });

      expect(s1.runId).not.toBe(s2.runId);
      expect(s1.sessionId).not.toBe(s2.sessionId);
      expect(s1.workspace).toBe('/test/a');
      expect(s2.workspace).toBe('/test/b');
    });

    test('closing one session does not affect another', () => {
      const s1 = manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      const s2 = manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });

      manager.closeSession(s1.sessionId);

      expect(manager.getSession(s1.sessionId)).toBeUndefined();
      expect(manager.getSession(s2.sessionId)).toBeDefined();
      expect(manager.getSession(s2.sessionId)?.runId).toBe(s2.runId);
    });

    test('closing one session does not cancel the other run', () => {
      const s1 = manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      manager.createSession({
        workspace: '/test/b',
        targetKind: 'physical',
      });

      manager.closeSession(s1.sessionId);

      const cancelCalls = mockRSM._calls.filter((c) => c.method === 'cancel');
      expect(cancelCalls.length).toBe(1);
    });
  });

  // ── sessionCount ──────────────────────────────────────────

  describe('sessionCount getter', () => {
    test('returns 0 for an empty manager', () => {
      expect(manager.sessionCount).toBe(0);
    });

    test('returns number of active sessions', () => {
      expect(manager.sessionCount).toBe(0);

      manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      expect(manager.sessionCount).toBe(1);

      manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });
      expect(manager.sessionCount).toBe(2);

      const s3 = manager.createSession({
        workspace: '/test/c',
        targetKind: 'physical',
      });
      expect(manager.sessionCount).toBe(3);

      manager.closeSession(s3.sessionId);
      expect(manager.sessionCount).toBe(2);
    });

    test('closeAll resets sessionCount to 0', () => {
      manager.createSession({
        workspace: '/test/a',
        targetKind: 'physical',
      });
      manager.createSession({
        workspace: '/test/b',
        targetKind: 'simulator',
      });

      manager.closeAll();

      expect(manager.sessionCount).toBe(0);
    });
  });

  // ── Idle timeout integration ──────────────────────────────

  describe('idle timeout (constructor option)', () => {
    test('accepts idleTimeoutMs in constructor without throwing', () => {
      expect(() => {
        new SessionManager({
          sseHub: new SSEHub(),
          // biome-ignore lint/suspicious/noExplicitAny: test mock typed differently from production DbClient
          db: createMockDb() as any,
          // biome-ignore lint/suspicious/noExplicitAny: test mock typed differently from RunStateMachine
          runStateMachine: createMockRunStateMachine() as any,
          idleTimeoutMs: 300_000,
        });
      }).not.toThrow();
    });
  });
});
