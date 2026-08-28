/**
 * cross-phase-pipeline.test.ts — Cross-phase integration tests (Phase 1→3).
 *
 * Verifies key data flows across the Phase pipeline:
 *   P1→P2: SessionManager.runId → ProjectProfile → TestPlan
 *   P1→P3: ArtifactStore stores evidence + Flow YAML
 *   P2→P3: Profile + Intent → ContextBuilder
 *   P2→P3: TestPlan device selector → BackendSelector
 *   P1→P3: RunStateMachine → PermissionEngine → SSEHub
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { AgentEvent } from 'itestagent-contracts';
import { MockDeviceBackend } from 'itestagent-device-mock';
import {
  BackendRegistry,
  BackendSelector,
  ContextBuilder,
  PermissionEngine,
  RunStateMachine,
  compileTestPlan,
  parseIntent,
} from 'itestagent-engine';
import type { ProjectProfile } from 'itestagent-project-analyzer';
import { SSEHub, SessionManager } from 'itestagent-server';
import {
  createArtifactStore,
  createDb,
  createStoreDriver,
  initStore,
  schema,
} from 'itestagent-store';

// ─── Mock DB ─────────────────────────────────────────────────

function mockDb() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};
  return {
    _tables: tables,
    insert(t: unknown) {
      let name: string;
      try {
        // biome-ignore lint/suspicious/noExplicitAny: mock — Drizzle table object types vary
        name = getTableName(t as any);
      } catch {
        // biome-ignore lint/suspicious/noExplicitAny: mock fallback for non-table objects
        name = String((t as any)?.config?.name ?? t);
      }
      if (!tables[name]) tables[name] = new Map();
      // biome-ignore lint/style/noNonNullAssertion: created above
      const tbl = tables[name]!;
      return {
        values(data: Record<string, unknown>) {
          const key = String(data.runId ?? data.projectHash ?? Bun.randomUUIDv7());
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
      let name: string;
      try {
        name = getTableName(t);
      } catch {
        name = String(t?.config?.name ?? t);
      }
      if (!tables[name]) tables[name] = new Map();
      // biome-ignore lint/style/noNonNullAssertion: created above
      const tbl = tables[name]!;
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

// ─── Fixtures ────────────────────────────────────────────────

function fixtureProfile(): ProjectProfile {
  return {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'a'.repeat(64),
    app: {
      name: 'TestApp',
      bundleId: 'com.test.app',
      workspace: 'TestApp.xcworkspace',
      scheme: 'TestApp',
    },
    targets: [{ name: 'TestApp', type: 'app', bundleId: 'com.test.app' }],
    testAssets: { hasXCUITest: false, hasScheme: true },
    features: [
      {
        name: 'Login',
        evidence: ['LoginViewController.swift'],
        confidence: 0.9,
        confirmed: true,
        displayOrder: 0,
      },
      {
        name: 'Dashboard',
        evidence: ['DashboardViewController.swift'],
        confidence: 0.7,
        confirmed: false,
        displayOrder: 1,
      },
    ],
    suggestedSmoke: ['Login'],
    generatedAt: new Date().toISOString(),
  } as ProjectProfile;
}

// ═════════════════════════════════════════════════════════════
// CP.1: Phase 1 → Phase 2 — SessionManager → TestPlan
// ═════════════════════════════════════════════════════════════

describe('CP.1: SessionManager → TestPlan (P1→P2)', () => {
  let sseHub: SSEHub;
  let rsm: RunStateMachine;
  let db: ReturnType<typeof mockDb>;

  beforeEach(() => {
    sseHub = new SSEHub();
    rsm = new RunStateMachine();
    db = mockDb();
  });

  test('createSession → runId compatible with TestPlan', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const sm = new SessionManager({ sseHub, db: db as any, runStateMachine: rsm });
    const session = sm.createSession({ workspace: '/tmp/test', targetKind: 'physical' });

    expect(session.runId).toStartWith('run_');
    expect(session.sessionId).toStartWith('ses_');

    const intent = parseIntent('test the Login feature on physical device', fixtureProfile());
    // biome-ignore lint/style/noNonNullAssertion: asserted .toBeDefined() above
    const plan = compileTestPlan(intent.intent!, fixtureProfile());

    expect(plan.device).toBeDefined();
    expect(plan.runId).toBeDefined();
  });

  test('session.close persists cancelled to DB', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const sm = new SessionManager({ sseHub, db: db as any, runStateMachine: rsm });
    const session = sm.createSession({ workspace: '/tmp/x', targetKind: 'simulator' });
    sm.closeSession(session.sessionId);

    expect(sm.getSession(session.sessionId)).toBeUndefined();
    // biome-ignore lint/style/noNonNullAssertion: created by insert
    const vals = [...db._tables.runs!.values()];
    // biome-ignore lint/suspicious/noExplicitAny: mock DB record
    expect(vals.some((r: any) => r.status === 'cancelled')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════
// CP.2: Phase 2 → Phase 3 — Profile → ContextBuilder → BackendSelector
// ═════════════════════════════════════════════════════════════

describe('CP.2: Profile + Intent → ContextBuilder + BackendSelector (P2→P3)', () => {
  test('ContextBuilder.buildSystemPrompt includes Profile features', () => {
    const builder = new ContextBuilder();
    const prompt = builder.buildSystemPrompt({
      projectProfile: fixtureProfile(),
      runState: 'created',
      // biome-ignore lint/suspicious/noExplicitAny: partial BuildContextInput for integration test
    } as any);
    expect(prompt).toContain('Login');
    expect(prompt).toContain('TestApp');
    expect(prompt).toContain('Confirmed Features');
  });

  test('ContextBuilder.sanitizeText removes secret patterns', () => {
    const builder = new ContextBuilder();
    const dirty = 'apiKey=sk-1234567890abcdef token=ghp_abcdef1234567890';
    const clean = builder.sanitizeText(dirty);
    expect(clean).not.toContain('sk-1234567890abcdef');
    expect(clean).not.toContain('ghp_abcdef1234567890');
  });

  test('BackendSelector.filterByTargetKind includes all matching backends', () => {
    // biome-ignore lint/suspicious/noExplicitAny: integration test
    const b1 = new MockDeviceBackend({ targetKind: 'physical' } as any);
    // biome-ignore lint/suspicious/noExplicitAny: integration test
    const b2 = new MockDeviceBackend({ targetKind: 'simulator' } as any);
    const reg = new BackendRegistry();
    reg.register('b1', b1);
    reg.register('b2', b2);

    const selector = new BackendSelector(reg);
    // filterByTargetKind returns all registered backends
    expect(selector.filterByTargetKind('physical').length).toBe(2);
  });

  test('parseIntent extracts features from natural language', () => {
    const result = parseIntent('test the Login feature', fixtureProfile());
    expect(result.intent).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted .toBeDefined() above
    expect(result.intent!.features).toContain('Login');
    // biome-ignore lint/style/noNonNullAssertion: asserted .toBeDefined() above
    expect(result.intent!.scope).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════
// CP.3: Phase 1 → Phase 3 — RSM → PermissionEngine → SSEHub
// ═════════════════════════════════════════════════════════════

describe('CP.3: RSM → PermissionEngine → SSEHub (P1→P3)', () => {
  let rsm: RunStateMachine;
  let sseHub: SSEHub;

  beforeEach(() => {
    rsm = new RunStateMachine();
    sseHub = new SSEHub();
  });

  test('RSM forward chain: created → planning → awaiting_confirm', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const sm = new SessionManager({ sseHub, db: mockDb() as any, runStateMachine: rsm });
    const session = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });

    expect(rsm.transitionFrom(session.runId, 'created', 'planning')).toBe('planning');
    expect(rsm.transitionFrom(session.runId, 'planning', 'awaiting_confirm')).toBe(
      'awaiting_confirm',
    );
  });

  test('RSM pause/resume', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const sm = new SessionManager({ sseHub, db: mockDb() as any, runStateMachine: rsm });
    const session = sm.createSession({ workspace: '/tmp/x', targetKind: 'physical' });

    rsm.transitionFrom(session.runId, 'created', 'planning');
    rsm.setStateForTesting(session.runId, 'planning');
    expect(rsm.pause(session.runId)).toBe('blocked');
    expect(rsm.isPaused(session.runId)).toBe(true);
    expect(rsm.resume(session.runId)).toBe('awaiting_confirm');
  });

  test('RSM cancel → done', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const sm = new SessionManager({ sseHub, db: mockDb() as any, runStateMachine: rsm });
    const session = sm.createSession({ workspace: '/tmp/x', targetKind: 'simulator' });

    rsm.setStateForTesting(session.runId, 'created');
    expect(rsm.cancel(session.runId)).toBe('cancelled');
    expect(rsm.transitionFrom(session.runId, 'cancelled', 'done')).toBe('done');
  });

  test('PermissionEngine.check returns ask for high-risk actions', () => {
    const pe = new PermissionEngine();
    expect(pe.check('clear_app_data', 'com.example.app')).toBe('ask');
  });

  test('PermissionEngine.check returns allow for safe actions', () => {
    const pe = new PermissionEngine();
    expect(pe.check('tap', 'button')).toBe('allow');
  });

  test('PermissionEngine rule deny overrides', () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: 'tap', resource: '*', effect: 'deny' });
    expect(pe.check('tap', 'button')).toBe('deny');
  });

  test('PermissionEngine rule allow overrides', () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: 'app:launch', resource: '*', effect: 'allow' });
    expect(pe.check('app:launch', 'com.test.app')).toBe('allow');
  });

  test('PermissionEngine cancel for high-risk ask rejects promise', async () => {
    // clear_app_data is in DEFAULT_HIGH_RISK_ACTIONS → check returns ask → requestPermission blocks
    const pe = new PermissionEngine();
    const promise = pe.requestPermission('c1', 'clear_app_data', 'com.test.app');
    pe.cancel('c1', 'user cancelled');
    // cancel calls pending.reject(), so the promise should reject
    let rejected = false;
    try {
      await promise;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  test('SSEHub isolates events per session', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const sm = new SessionManager({ sseHub, db: mockDb() as any, runStateMachine: rsm });
    const sa = sm.createSession({ workspace: '/tmp/a', targetKind: 'physical' });
    const sb = sm.createSession({ workspace: '/tmp/b', targetKind: 'simulator' });

    const ra = sseHub.subscribe(sa.sessionId).getReader();
    const rb = sseHub.subscribe(sb.sessionId).getReader();

    sseHub.broadcast(sa.sessionId, {
      type: 'session.started',
      sessionId: sa.sessionId,
      runId: sa.runId,
    } as unknown as AgentEvent);

    const a = await ra.read();
    expect(a.done).toBe(false);
    expect(new TextDecoder().decode(a.value)).toContain(sa.sessionId);

    // Session B should never see session A's event
    const timeout = new Promise<'t'>((r) => setTimeout(() => r('t'), 100));
    expect(await Promise.race([rb.read(), timeout])).toBe('t');

    ra.releaseLock();
    rb.releaseLock();
  });
});

// ═════════════════════════════════════════════════════════════
// CP.4: Phase 1 Store → ArtifactStore (P1 → P2/P3 data)
// ═════════════════════════════════════════════════════════════

describe('CP.4: ArtifactStore + Real DB (P1 store → P2/P3)', () => {
  let storeRoot: string;

  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), 'itestagent-cp4-'));
  });

  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  test('flow YAML artifact stored and retrievable via ArtifactRef', async () => {
    initStore(storeRoot);
    const artifacts = createArtifactStore(join(storeRoot, 'artifacts'));

    const ref = await artifacts.put({
      type: 'text',
      data: Buffer.from('name: login-flow\nsteps:\n  - tap: Sign In\n'),
    });
    expect(ref.id).toBeDefined();
    expect(ref.type).toBe('text');

    const retrieved = await artifacts.get(ref.id);
    expect(retrieved).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted .toBeDefined() above
    expect(retrieved!.id).toBe(ref.id);
    // biome-ignore lint/style/noNonNullAssertion: asserted .toBeDefined() above
    expect(retrieved!.type).toBe('text');
  });

  test('screenshot artifact stored with correct type', async () => {
    initStore(storeRoot);
    const artifacts = createArtifactStore(join(storeRoot, 'artifacts'));

    const ref = await artifacts.put({
      type: 'screenshot',
      data: Buffer.from('png-data'),
    });
    expect(ref.type).toBe('screenshot');
    expect(ref.id).toBeDefined();
  });

  test('artifacts searchable by type via string query', async () => {
    initStore(storeRoot);
    const artifacts = createArtifactStore(join(storeRoot, 'artifacts'));

    await artifacts.put({ type: 'screenshot', data: Buffer.from('a') });
    await artifacts.put({ type: 'screenshot', data: Buffer.from('b') });
    await artifacts.put({ type: 'crashlog', data: Buffer.from('c') });

    const screenshots = await artifacts.search('screenshot');
    expect(screenshots.length).toBe(2);

    const crashlogs = await artifacts.search('crashlog');
    expect(crashlogs.length).toBe(1);
  });

  test('real SQLite: SessionManager persists run with targetKind', async () => {
    initStore(storeRoot);
    const dbPath = join(storeRoot, 'db', 'itestagent.db');
    const storeDriver = createStoreDriver(dbPath);
    await storeDriver.migrate();
    const db = createDb(dbPath);

    const sm = new SessionManager({
      sseHub: new SSEHub(),
      db,
      runStateMachine: new RunStateMachine(),
    });

    const session = sm.createSession({
      workspace: '/tmp/test',
      targetKind: 'physical',
      backend: 'appium',
    });
    // Wait for async DB persist (.catch)
    await new Promise((r) => setTimeout(r, 300));

    const results = db.select().from(schema.runs).all();
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.runId === session.runId)).toBe(true);
    expect(results.some((r) => r.targetKind === 'physical')).toBe(true);
  });
});

// ─── B33: migration alignment (integration foundation) ─────────────

describe('B33 migration alignment', () => {
  test('reports the migration-aligned contract surface as coherent', async () => {
    const mod = await import('../../../packages/itestagent-engine/src/migration-alignment.js');
    const result = await mod.checkMigrationAlignment();
    expect(result.ok).toBe(true);
  });
});
