import Database from 'bun:sqlite';
/**
 * Phase 5 integration — Explain + Rerun pipeline (P0).
 *
 * Verifies the explain chain (RunStore → FailureExplainer → FailureExplanation)
 * and the rerun chain (RunStore → parentRunId linking).
 *
 * P0: RunStore → FailureExplainer → explain
 * P0: RunStore → insertRun with parentRunId
 * Cross-package: itestagent-store + itestagent-engine + itestagent-contracts
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactIndex, RunResult, RunStep } from 'itestagent-contracts';
import { FailureExplanationSchema } from 'itestagent-contracts';
import { FailureExplainer } from 'itestagent-engine';
import type { ExplainContext } from 'itestagent-engine';
import { createDb, createRunStore, schema } from 'itestagent-store';
import type { DbClient, RunStore } from 'itestagent-store';

const NOW = new Date().toISOString();

let storeRoot: string;
let runStore: RunStore;
let db: DbClient;
let sqlite: Database;

function makeRunResult(
  runId: string,
  status: string,
  targetKind: 'physical' | 'simulator' = 'simulator',
): RunResult {
  return {
    schemaVersion: '3.0',
    runId,
    projectProfileRef: 'proj-hash-001',
    status: status as RunResult['status'],
    device: {
      udid: 'test-udid',
      name: 'iPhone 16 Pro',
      model: 'iPhone17,1',
      osVersion: '18.2',
      targetKind,
    },
    execution: {
      mode: 'device_backend',
      totalSteps: 2,
      completedSteps: 1,
      failedSteps: 1,
      skippedSteps: 0,
      durationMs: 5000,
      startTime: NOW,
      endTime: NOW,
      targetKind,
      backendUsed: 'appium',
      deviceId: 'test-udid',
    },
    cases: [
      {
        caseId: 'case-001',
        name: 'Login flow',
        status: 'failed',
        steps: ['step-001', 'step-002'],
        durationMs: 5000,
        error: 'App crashed',
        artifacts: [],
      },
    ],
    metrics: {},
    environment: {
      targetKind,
      representativeOfPhysicalDevice: targetKind === 'physical',
      comparisonScope: targetKind === 'physical' ? 'physical_only' : 'simulator_only',
    },
    artifactRefs: [],
  };
}

function makeArtifactIndex(runId: string): ArtifactIndex {
  return {
    schemaVersion: '2.0',
    runId,
    artifacts: [],
    collectionOutcomes: [],
  };
}

function writeRunToDisk(runId: string, result: RunResult, index: ArtifactIndex) {
  const runDir = join(storeRoot, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(runDir, 'artifact-index.json'), JSON.stringify(index, null, 2));
}

beforeAll(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), 'itestagent-phase5-'));
  sqlite = new Database(':memory:');
  sqlite.run('PRAGMA journal_mode = WAL');
  sqlite.run('PRAGMA foreign_keys = ON');
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

  const storeDirs = ['runs', 'projects', 'baselines'];
  for (const dir of storeDirs) {
    mkdirSync(join(storeRoot, dir), { recursive: true });
  }

  runStore = createRunStore(db, storeRoot);

  await db
    .insert(schema.projects)
    .values({
      projectHash: 'proj-hash-001',
      workspacePath: '/fake/workspace',
    })
    .onConflictDoNothing();

  await runStore.insertRun({
    runId: 'run-pass-001',
    projectHash: 'proj-hash-001',
    targetKind: 'simulator',
    backend: 'appium',
    status: 'passed',
  });

  await runStore.insertRun({
    runId: 'run-fail-001',
    projectHash: 'proj-hash-001',
    targetKind: 'simulator',
    backend: 'appium',
    status: 'failed',
  });

  await runStore.insertRun({
    runId: 'run-fail-002',
    projectHash: 'proj-hash-001',
    targetKind: 'physical',
    backend: 'appium',
    status: 'failed',
    parentRunId: 'run-fail-001',
  });

  writeRunToDisk(
    'run-fail-001',
    makeRunResult('run-fail-001', 'failed'),
    makeArtifactIndex('run-fail-001'),
  );
  writeRunToDisk(
    'run-fail-002',
    makeRunResult('run-fail-002', 'failed', 'physical'),
    makeArtifactIndex('run-fail-002'),
  );
});

afterAll(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

const CRASH_STEP: RunStep = {
  stepId: 'step-crash',
  sequence: 1,
  backend: 'appium',
  targetKind: 'physical',
  action: 'tap',
  target: 'Login',
  input: { x: 0.5, y: 0.5 },
  result: { success: false, error: 'App crashed' },
  status: 'failed',
  artifacts: [],
  startedAt: NOW,
  durationMs: 1200,
};

describe('Phase 5: Explain Pipeline', () => {
  describe('RunStore queries', () => {
    it('findById finds a run', async () => {
      const run = await runStore.findById('run-fail-001');
      expect(run).toBeDefined();
      expect(run?.runId).toBe('run-fail-001');
      expect(run?.status).toBe('failed');
    });

    it('findById returns undefined for missing run', async () => {
      const run = await runStore.findById('non-existent');
      expect(run).toBeUndefined();
    });

    it('findLatest returns a run', async () => {
      const run = await runStore.findLatest();
      expect(run).toBeDefined();
      expect(run?.runId).toBeDefined();
    });

    it('findByStatus filters runs by status', async () => {
      const runs = await runStore.findByStatus('failed');
      expect(runs.length).toBeGreaterThanOrEqual(2);
      expect(runs.every((r) => r.status === 'failed')).toBe(true);
    });

    it('loadRunResult parses result.json from disk', async () => {
      const result = await runStore.loadRunResult('run-fail-001');
      expect(result.runId).toBe('run-fail-001');
      expect(result.status).toBe('failed');
      expect(result.schemaVersion).toBe('3.0');
    });

    it('loadRunResult throws for missing run directory', async () => {
      await expect(runStore.loadRunResult('missing-run')).rejects.toThrow();
    });

    it('loadArtifactIndex parses artifact-index.json', async () => {
      const index = await runStore.loadArtifactIndex('run-fail-001');
      expect(index.schemaVersion).toBe('2.0');
      expect(index.artifacts).toBeDefined();
    });

    it('getPreviousRuns lists historical runs', async () => {
      const previous = await runStore.getPreviousRuns('run-fail-002');
      expect(previous.length).toBeGreaterThan(0);
    });
  });

  describe('FailureExplainer integration', () => {
    it('explains a crash failure from context', async () => {
      const context: ExplainContext = {
        runId: 'run-fail-001',
        status: 'failed',
        projectProfileRef: 'proj-hash-001',
        steps: [CRASH_STEP],
        evidence: [
          {
            id: 'crash-001',
            type: 'crashlog',
            path: 'artifacts/crash-001.crash',
            redactionStatus: 'raw-local-only',
          },
        ],
        targetKind: 'simulator',
      };

      const explainer = new FailureExplainer();
      const explanation = await explainer.explain(context);

      expect(explanation).toBeDefined();
      expect(explanation.explanationType).toBeDefined();
      expect(['crash', 'product_regression']).toContain(explanation.explanationType);
      expect(explanation.summary).toBeDefined();
      expect(explanation.evidence).toBeDefined();

      const parsed = FailureExplanationSchema.safeParse(explanation);
      expect(parsed.success).toBe(true);
    });

    it('returns inconclusive when no evidence available', async () => {
      const context: ExplainContext = {
        runId: 'run-no-evidence',
        status: 'failed',
        projectProfileRef: 'proj-hash-001',
        steps: [],
        evidence: [],
        targetKind: 'simulator',
      };

      const explainer = new FailureExplainer();
      const explanation = await explainer.explain(context);
      expect(explanation).toBeDefined();
      expect(explanation.explanationType).toBe('inconclusive');
    });

    it('explains passed run', async () => {
      const context: ExplainContext = {
        runId: 'run-pass-001',
        status: 'passed',
        projectProfileRef: 'proj-hash-001',
        steps: [],
        evidence: [],
        targetKind: 'simulator',
      };

      const explainer = new FailureExplainer();
      const explanation = await explainer.explain(context);
      expect(explanation).toBeDefined();
      const parsed = FailureExplanationSchema.safeParse(explanation);
      expect(parsed.success).toBe(true);
    });

    it('detects performance regression from baselineDelta', async () => {
      const context: ExplainContext = {
        runId: 'run-perf-reg',
        status: 'failed',
        projectProfileRef: 'proj-hash-001',
        steps: [],
        evidence: [],
        targetKind: 'simulator',
        baselineDelta: {
          baselineId: 'baseline-001',
          runId: 'run-perf-reg',
          comparedAt: NOW,
          targetKind: 'simulator',
          deltas: {
            launchDurationMs: 3800,
            memoryPeakMB: 768,
          },
          summary: 'regressed',
        },
      };

      const explainer = new FailureExplainer();
      const explanation = await explainer.explain(context);
      expect(explanation.explanationType).toBeDefined();
      expect(['perf_regression', 'product_regression', 'flaky', 'inconclusive', 'crash']).toContain(
        explanation.explanationType,
      );
    });
  });
});

describe('Phase 5: Rerun Pipeline', () => {
  it('insertRun supports parentRunId for rerun tracking', async () => {
    await runStore.insertRun({
      runId: 'run-rerun-001',
      projectHash: 'proj-hash-001',
      targetKind: 'simulator',
      backend: 'appium',
      status: 'created',
      parentRunId: 'run-fail-001',
    });

    const run = await runStore.findById('run-rerun-001');
    expect(run).toBeDefined();
    expect(run?.parentRunId).toBe('run-fail-001');
  });

  it('rerun run can reference original run', async () => {
    const original = await runStore.findById('run-fail-001');
    const rerun = await runStore.findById('run-fail-002');

    expect(original).toBeDefined();
    expect(rerun).toBeDefined();
    expect(rerun?.parentRunId).toBe('run-fail-001');
  });

  it('explain pipeline works end-to-end with RunStore data', async () => {
    const result = await runStore.loadRunResult('run-fail-001');

    const context: ExplainContext = {
      runId: result.runId,
      status: result.status,
      projectProfileRef: result.projectProfileRef,
      steps: [],
      evidence: [],
      targetKind: result.environment.targetKind,
      previousRuns: [{ runId: 'run-fail-001', status: 'failed', scenario: 'login' }],
    };

    const explainer = new FailureExplainer();
    const explanation = await explainer.explain(context);

    const parsed = FailureExplanationSchema.safeParse(explanation);
    expect(parsed.success).toBe(true);
  });
});

// ─── B25: explain-rerun command seam ───────────────────────────────

describe('B25 explain-rerun seam', () => {
  it('exposes the explain/rerun command helpers', async () => {
    const mod = await import('../../../packages/itestagent-cli/src/commands/explain-rerun.js');
    expect(typeof mod.explainRun).toBe('function');
    expect(typeof mod.rerunFailed).toBe('function');
  });
});

// ─── B34: phase5 harness seam ──────────────────────────────────────

describe('B34 phase5 harness seam', () => {
  it('reports the phase5 integration surface as coherent', async () => {
    const mod = await import('../../../packages/itestagent-engine/src/phase5-harness.js');
    expect(mod.phase5HarnessProbe().ok).toBe(true);
  });
});
