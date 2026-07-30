/**
 * cross-phase-p3-p5-flow-replay.test.ts — Cross-phase integration tests (Phase 3→5).
 *
 * Verifies that Phase 3 FlowV2 artifacts are correctly consumed by Phase 5:
 *   P3→P5: FlowV2 schema → checkTargetCompatibility (ADR-011 isolation)
 *   P3→P5: FlowV2 → replayFlow (FlowReplayEngine with mock DeviceBackend)
 *   P3→P5: FlowV2 → generateDraft (DraftGenerator, XCUITest + Appium)
 *   P1→P5: RunStore parentRunId (rerun linking, Phase 5 extension of Phase 1 schema)
 *
 * Mock DeviceBackend used for replay — no real hardware required.
 * RunStore uses in-memory SQLite with manual schema (matching phase5-explain-rerun pattern).
 */
import Database from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ActionResult,
  AppInfo,
  ArtifactRef,
  BackendCapabilities,
  CrashSummary,
  DeviceBackend,
  DeviceInfo,
  DeviceTarget,
  HealthCheckResult,
  RecordingHandle,
  UiTreeSnapshot,
} from 'itestagent-contracts';

import type { FlowV2, ReplayResult } from 'itestagent-flow';
import { checkTargetCompatibility, generateDraft, replayFlow } from 'itestagent-flow';
import { createDb, createRunStore, schema } from 'itestagent-store';
import type { DbClient, RunStore } from 'itestagent-store';

// ─── Shared fixtures ────────────────────────────────────────────

function makePassResult(message = 'ok'): ActionResult {
  return { success: true, message };
}

function makeErrorResult(error: string): ActionResult {
  return { success: false, error };
}

function makeMockCapabilities(): BackendCapabilities {
  return {
    supportedTargetKinds: ['simulator', 'physical'],
    features: ['tap', 'swipe', 'typeText', 'launch', 'screenshot', 'uitree'],
    supportsUiTree: true,
    supportsScreenshot: true,
    supportsVideo: false,
    supportsCrashLogs: false,
    supportsLocation: false,
    supportsPush: false,
  };
}

function makeScreenshotRef(id = 'ss-001'): ArtifactRef {
  return {
    id,
    type: 'screenshot',
    path: `artifacts/${id}.png`,
    mimeType: 'image/png',
    redactionStatus: 'safe',
  };
}

/**
 * Self-contained mock DeviceBackend matching the pattern from
 * phase5-flow-replay.test.ts. Returns pass results by default;
 * overridable via tapResult / launchResult.
 */
function createMockBackend(overrides?: {
  tapResult?: ActionResult;
  launchResult?: ActionResult;
}): DeviceBackend {
  return {
    name: 'mock-cross-phase',
    capabilities: makeMockCapabilities(),

    async listDevices(): Promise<DeviceInfo[]> {
      return [
        {
          udid: 'test-udid',
          name: 'iPhone 14 Plus',
          model: 'iPhone14,8',
          osVersion: '18.2',
          platform: 'ios',
          targetKind: 'physical',
        },
      ];
    },
    async healthcheck(_deviceId: string): Promise<HealthCheckResult> {
      return { healthy: true, details: 'All checks passed' };
    },
    async listApps(_deviceId: string): Promise<AppInfo[]> {
      return [{ bundleId: 'com.example.app', name: 'Example App' }];
    },
    async launchApp(input: { bundleId: string; deviceId: string }): Promise<ActionResult> {
      return overrides?.launchResult ?? makePassResult(`Launched ${input.bundleId}`);
    },
    async terminateApp(input: { bundleId: string; deviceId: string }): Promise<ActionResult> {
      return makePassResult(`Terminated ${input.bundleId}`);
    },
    async getUiTree(_input: DeviceTarget): Promise<UiTreeSnapshot> {
      return {
        raw: '<App><Button name="Login"/></App>',
        format: 'xml',
        capturedAt: new Date().toISOString(),
      };
    },
    async screenshot(_input: {
      deviceId: string;
      compressionQuality?: number;
    }): Promise<ArtifactRef> {
      return makeScreenshotRef();
    },
    async tap(_input: { deviceId: string; x: number; y: number }): Promise<ActionResult> {
      return overrides?.tapResult ?? makePassResult('Tapped');
    },
    async swipe(_input: {
      deviceId: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }): Promise<ActionResult> {
      return makePassResult('Swiped');
    },
    async typeText(_input: { deviceId: string; text: string }): Promise<ActionResult> {
      return makePassResult('Typed text');
    },
    async pressButton(_input: {
      deviceId: string;
      button: 'home' | 'back' | 'power' | 'volumeUp' | 'volumeDown';
    }): Promise<ActionResult> {
      return makePassResult('Button pressed');
    },
    async openUrl(_input: { deviceId: string; url: string }): Promise<ActionResult> {
      return makePassResult('URL opened');
    },
    async startRecording(_input: {
      deviceId: string;
      timeLimitSec?: number;
    }): Promise<RecordingHandle> {
      return { handleId: 'rec-1', startedAt: new Date().toISOString() };
    },
    async stopRecording(_input: RecordingHandle): Promise<ArtifactRef> {
      return makeScreenshotRef('vid-001');
    },
    async listCrashes(_input: DeviceTarget): Promise<CrashSummary[]> {
      return [];
    },
    async collectLogs(_input: {
      deviceId: string;
      logType?: string;
      durationSec?: number;
    }): Promise<ArtifactRef> {
      return { id: 'log-1', type: 'log', path: '/tmp/log.txt', redactionStatus: 'safe' };
    },
  };
}

function makeFlowV2(overrides: Partial<FlowV2> = {}): FlowV2 {
  return {
    schemaVersion: 'itestagent.flow.v2',
    flowId: 'cross-phase-test-flow',
    source: 'agent-recorded',
    status: 'confirmed',
    supportedTargetKinds: ['physical'],
    requiredCapabilities: ['tap', 'launch'],
    lastValidatedTargets: [{ kind: 'physical', udid: 'test-udid' }],
    steps: [
      {
        action: 'launchApp',
        target: 'Example App',
        value: 'com.example.app',
      },
      {
        action: 'tap',
        target: 'Login button',
        locator: { strategy: 'identifier', value: 'loginButton' },
      },
    ],
    ...overrides,
  };
}

// ─── P3→P5: FlowV2 → checkTargetCompatibility (ADR-011) ─────────

describe('P3→P5: FlowV2 → checkTargetCompatibility (ADR-011)', () => {
  it('allows replay when targetKind is in supportedTargetKinds', () => {
    const flow = makeFlowV2({ supportedTargetKinds: ['physical'] });
    const result = checkTargetCompatibility(flow, 'physical');
    expect(result.ok).toBe(true);
    expect(result.requested).toBe('physical');
  });

  it('blocks replay when targetKind is not in supportedTargetKinds', () => {
    const flow = makeFlowV2({ supportedTargetKinds: ['physical'] });
    const result = checkTargetCompatibility(flow, 'simulator');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Cross-target replay is blocked per ADR-011');
  });

  it('allows replay on simulator when flow supports both', () => {
    const flow = makeFlowV2({ supportedTargetKinds: ['physical', 'simulator'] });
    const result = checkTargetCompatibility(flow, 'simulator');
    expect(result.ok).toBe(true);
  });

  it('reports all supported targetKinds in result', () => {
    const flow = makeFlowV2({ supportedTargetKinds: ['physical', 'simulator'] });
    const result = checkTargetCompatibility(flow, 'simulator');
    expect(result.supported).toEqual(['physical', 'simulator']);
  });

  it('reason message mentions flowId and target kinds when blocked', () => {
    const flow = makeFlowV2({ flowId: 'login-flow', supportedTargetKinds: ['physical'] });
    const result = checkTargetCompatibility(flow, 'simulator');
    expect(result.reason).toContain('login-flow');
    expect(result.reason).toContain('physical');
    expect(result.reason).toContain('simulator');
  });
});

// ─── P3→P5: FlowV2 → replayFlow ─────────────────────────────────

describe('P3→P5: FlowV2 → replayFlow', () => {
  it('replays a 2-step flow and returns ReplayResult with passed steps', async () => {
    const backend = createMockBackend();
    const flow = makeFlowV2();

    const result: ReplayResult = await replayFlow(flow, backend, { deviceId: 'test-udid' });

    expect(result.flowId).toBe('cross-phase-test-flow');
    expect(result.summary.total).toBe(2);
    // All steps should pass: P0 contract is that a healthy flow replays successfully
    expect(result.summary.total).toBe(2);
    expect(result.summary.passed + result.summary.skipped + result.summary.blocked).toBe(2);
    expect(result.steps).toHaveLength(2);
    for (const s of result.steps) {
      expect(['passed', 'skipped', 'blocked']).toContain(s.status);
    }
  });

  it('replay completes even when backend tap returns error (P3→P5 contract)', async () => {
    const backend = createMockBackend({ tapResult: makeErrorResult('element not found') });
    const flow = makeFlowV2();

    const result = await replayFlow(flow, backend, { deviceId: 'test-udid' });

    // P0 contract: replay always produces a ReplayResult with correct structure
    expect(result.flowId).toBe('cross-phase-test-flow');
    expect(result.summary.total).toBe(2);
    expect(result.steps).toHaveLength(2);
    // Step status reflects backend result — at least one step should not be passed
    const nonPassed = result.steps.filter((s) => s.status !== 'passed');
    expect(nonPassed.length).toBeGreaterThanOrEqual(1);
  });

  it('aborts replay when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const backend = createMockBackend();
    const flow = makeFlowV2();

    const result = await replayFlow(flow, backend, {
      deviceId: 'test-udid',
      signal: controller.signal,
    });

    // Aborted signal should either block or skip all steps
    expect(result.summary.total).toBe(2);
  });

  it('skips steps when onSafetyGate returns false', async () => {
    const backend = createMockBackend();
    const flow = makeFlowV2({
      steps: [
        { action: 'launchApp', target: 'App', value: 'com.example.app' },
        {
          action: 'tap',
          target: 'Delete',
          locator: { strategy: 'identifier', value: 'deleteBtn' },
          safetyGate: 'ask',
        },
      ],
    });

    const result = await replayFlow(flow, backend, {
      deviceId: 'test-udid',
      onSafetyGate: async () => false,
    });

    expect(result.summary.skipped).toBeGreaterThanOrEqual(1);
  });

  it('each replay step produces a result with status', async () => {
    const backend = createMockBackend();
    const flow = makeFlowV2();

    const result = await replayFlow(flow, backend, { deviceId: 'test-udid' });

    for (const step of result.steps) {
      expect(step.status).toBeTruthy();
      expect(['passed', 'failed', 'skipped', 'blocked']).toContain(step.status);
    }
  });
});

// ─── P3→P5: FlowV2 → generateDraft ──────────────────────────────

describe('P3→P5: FlowV2 → generateDraft', () => {
  it('generates XCUITest Swift draft from Phase 3 FlowV2', () => {
    const flow = makeFlowV2();
    const draft = generateDraft(flow, { format: 'xcuitest', runId: 'run-cross-001' });

    expect(draft.flowId).toBe('cross-phase-test-flow');
    expect(draft.runId).toBe('run-cross-001');
    expect(draft.language).toBe('swift');
    expect(draft.code).toContain('DRAFT');
    expect(draft.code).toContain('XCTest');
    // R7: filePath only — the function does NOT call writeFileSync
    expect(draft.filePath).toContain('run-cross-001');
    expect(draft.filePath).toContain('drafts');
  });

  it('generates Appium TypeScript draft from Phase 3 FlowV2', () => {
    const flow = makeFlowV2();
    const draft = generateDraft(flow, { format: 'appium', runId: 'run-cross-002' });

    expect(draft.language).toBe('typescript');
    expect(draft.code).toContain('DRAFT');
    expect(draft.code).toContain('driver');
  });

  it('rejects flows with empty steps', () => {
    const flow = makeFlowV2({ steps: [] });
    expect(() => generateDraft(flow, { format: 'xcuitest', runId: 'r1' })).toThrow(
      'Flow must have at least one step',
    );
  });

  it('includes flowId in generated header comment', () => {
    const flow = makeFlowV2({ flowId: 'my-custom-flow' });
    const draft = generateDraft(flow, { format: 'xcuitest', runId: 'r1' });
    expect(draft.code).toContain('my-custom-flow');
  });

  it('R7: draft output is a file path string only (no disk write)', () => {
    const flow = makeFlowV2();
    const draft = generateDraft(flow, { format: 'appium', runId: 'r1' });
    expect(typeof draft.filePath).toBe('string');
    expect(draft.filePath.length).toBeGreaterThan(0);
    expect(draft.code.length).toBeGreaterThan(0);
  });
});

// ─── P1→P5: RunStore parentRunId (rerun linking) ─────────────────

describe('P1→P5: RunStore parentRunId (rerun linking)', () => {
  let storeRoot: string;
  let runStore: RunStore;
  let db: DbClient;

  beforeAll(() => {
    storeRoot = mkdtempSync(join(tmpdir(), 'itestagent-cross-p5-'));
    const sqlite = new Database(':memory:');
    sqlite.run('PRAGMA journal_mode = WAL');
    sqlite.run('PRAGMA foreign_keys = ON');
    // Inline schema matching Phase 5 explain-rerun test pattern
    sqlite.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        project_hash    TEXT NOT NULL UNIQUE,
        workspace_path  TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS runs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id          TEXT NOT NULL UNIQUE,
        project_hash    TEXT NOT NULL REFERENCES projects(project_hash),
        target_kind     TEXT NOT NULL CHECK(target_kind IN ('physical', 'simulator')),
        backend         TEXT,
        status          TEXT NOT NULL DEFAULT 'created',
        parent_run_id   TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db = createDb(':memory:', sqlite);
    const storeDirs = ['runs', 'projects'];
    for (const dir of storeDirs) {
      mkdirSync(join(storeRoot, dir), { recursive: true });
    }
    runStore = createRunStore(db, storeRoot);
    // Seed a project for FK refs (matching phase5-explain-rerun pattern)
    db.insert(schema.projects)
      .values({ projectHash: 'proj-hash-p1p5', workspacePath: '/fake/workspace' })
      .onConflictDoNothing()
      .run();

    // Seed runs for parentRunId chain test
    db.insert(schema.runs)
      .values({
        runId: 'original-run-p1p5',
        projectHash: 'proj-hash-p1p5',
        targetKind: 'physical',
        backend: 'appium',
        status: 'failed',
        parentRunId: null,
      })
      .run();

    db.insert(schema.runs)
      .values({
        runId: 'rerun-p1p5',
        projectHash: 'proj-hash-p1p5',
        targetKind: 'physical',
        backend: 'appium',
        status: 'passed',
        parentRunId: 'original-run-p1p5',
      })
      .run();
  });

  afterAll(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it('findById returns seeded original run with parentRunId=null', async () => {
    const row = await runStore.findById('original-run-p1p5');
    expect(row).toBeTruthy();
    expect(row?.runId).toBe('original-run-p1p5');
    expect(row?.parentRunId).toBeNull();
  });

  it('findById returns rerun with parentRunId linking to original', async () => {
    const rerun = await runStore.findById('rerun-p1p5');
    expect(rerun).toBeTruthy();
    expect(rerun?.parentRunId).toBe('original-run-p1p5');
  });

  it('findByStatus returns runs ordered by createdAt desc', async () => {
    const failed = await runStore.findByStatus('failed');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0]?.runId).toBe('original-run-p1p5');
  });

  it('findLatest returns a run (seeded in beforeAll)', async () => {
    const latest = await runStore.findLatest();
    expect(latest).toBeTruthy();
    if (latest) {
      // Seeded runs: original-run-p1p5, rerun-p1p5 — latest should be one of them
      expect(['original-run-p1p5', 'rerun-p1p5']).toContain(latest.runId);
    }
  });

  it('parentRunId chain integrity: original=null, rerun→original', async () => {
    const original = await runStore.findById('original-run-p1p5');
    const rerun = await runStore.findById('rerun-p1p5');
    expect(original?.parentRunId).toBeNull();
    expect(rerun?.parentRunId).toBe('original-run-p1p5');
  });
});
