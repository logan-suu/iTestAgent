/**
 * cross-phase-p1-p4-evidence-report.test.ts — Cross-phase integration tests (Phase 1→4).
 *
 * Verifies key data flows across the Phase pipeline:
 *   P1→P4: StoreDriver → BaselineStore (ADR-011 domain isolation)
 *   P2→P4: TestPlan → BaselineManager (performance config → baseline CRUD)
 *   P3→P4: RunStep + ArtifactRef → FailureExplainer → ReportSynthesizer
 *   P1→P4: createStoreCore → store artifacts → report synthesis
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BaselineListFilter,
  BaselineRecord,
  BaselineStore,
  RunStep,
  TraceSummary,
} from 'itestagent-contracts';
import { BaselineManager, FailureExplainer } from 'itestagent-engine';
import type { ArtifactEntry } from 'itestagent-report';
import { ReportSynthesizer } from 'itestagent-report';
import { createBaselineStore, createStoreCore, initStore, schema } from 'itestagent-store';

// ─── Fixtures ────────────────────────────────────────────────

function makeTraceSummary(overrides?: Partial<TraceSummary>): TraceSummary {
  return {
    launchDurationMs: 1500,
    memoryPeakMB: 100,
    hangCount: 0,
    fpsApproximate: 58,
    approximate: true,
    ...overrides,
  };
}

function fixtureRunStep(overrides?: Partial<RunStep>): RunStep {
  return {
    stepId: 's1',
    backend: 'appium',
    action: 'tap',
    target: 'login_button',
    input: { target: 'login_button' },
    result: { success: false, error: 'AppiumDriverError: session_not_found' },
    artifacts: ['screenshot_err_001', 'uitree_err_001'],
    startedAt: new Date().toISOString(),
    durationMs: 1200,
    ...overrides,
  };
}

function fixtureArtifactEntry(id: string, overrides?: Partial<ArtifactEntry>): ArtifactEntry {
  return {
    id,
    type: 'screenshot',
    path: `/tmp/test/${id}.png`,
    mimeType: 'image/png',
    redactionStatus: 'safe',
    relatedStep: 's1',
    ...overrides,
  };
}

// ─── Mock BaselineStore ──────────────────────────────────────

class MockBaselineStore implements BaselineStore {
  private store = new Map<string, BaselineRecord>();

  async get(key: string): Promise<BaselineRecord | null> {
    return this.store.get(key) ?? null;
  }

  async save(record: BaselineRecord): Promise<void> {
    this.store.set(record.key, record);
  }

  async list(filter?: BaselineListFilter): Promise<BaselineRecord[]> {
    const records = [...this.store.values()];
    if (!filter) return records;
    return records.filter((r) => {
      if (filter.projectId && !r.key.startsWith(filter.projectId)) return false;
      if (filter.targetKind && r.targetKind !== filter.targetKind) return false;
      if (filter.scenario && !r.key.includes(filter.scenario)) return false;
      return true;
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ═════════════════════════════════════════════════════════════
// CP.5: P1 StoreDriver → P4 BaselineStore (real filesystem)
// ═════════════════════════════════════════════════════════════

describe('CP.5: StoreDriver (P1) → BaselineStore (P4)', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'cp5-'));
    initStore(testRoot);
  });

  afterEach(() => rmSync(testRoot, { recursive: true, force: true }));

  it('BaselineStore CRUD with physical targetKind (real FS)', async () => {
    const baselineStore = createBaselineStore(testRoot);
    const mgr = new BaselineManager({ baselineStore });
    const summary = makeTraceSummary({ launchDurationMs: 1567, memoryPeakMB: 124 });

    const key = mgr.buildBaselineKeyFromContext({
      projectId: 'cp5-test',
      targetKind: 'physical',
      deviceModel: 'iPhone14,8',
      iosVersion: '18.2.1',
      scenario: 'launch_cold',
    });
    expect(key).toBe('cp5-test|physical|iPhone14,8|18.2.1|launch_cold');

    const record = await mgr.establishBaseline(summary, {
      projectId: 'cp5-test',
      targetKind: 'physical',
      deviceModel: 'iPhone14,8',
      iosVersion: '18.2.1',
      scenario: 'launch_cold',
      runId: 'run_001',
    });

    expect(record.targetKind).toBe('physical');
    expect(record.launchDurationMs).toBe(1567);
    expect(record.comparisonScope).toBeUndefined();

    const saved = await baselineStore.get(key);
    expect(saved).not.toBeNull();
    expect(saved?.targetKind).toBe('physical');
  });

  it('BaselineStore CRUD with simulator targetKind (ADR-011 metadata)', async () => {
    const baselineStore = createBaselineStore(testRoot);
    const mgr = new BaselineManager({ baselineStore });

    const record = await mgr.establishBaseline(makeTraceSummary(), {
      projectId: 'cp5-test',
      targetKind: 'simulator',
      deviceModel: 'iPhone 16 Pro',
      iosVersion: '18.2',
      scenario: 'launch_cold',
      runId: 'run_sim_001',
      hostFingerprint: 'macOS-15.2-arm64',
      xcodeVersion: '26.5',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    });

    expect(record.targetKind).toBe('simulator');
    expect(record.comparisonScope).toBe('simulator_only');
    expect(record.representativeOfPhysicalDevice).toBe(false);
    expect(record.hostFingerprint).toBe('macOS-15.2-arm64');
    expect(record.xcodeVersion).toBe('26.5');
  });

  it('shouldEstablishBaseline: passed → true, failed → false', () => {
    const mock = new MockBaselineStore();
    const mgr = new BaselineManager({ baselineStore: mock });

    expect(mgr.shouldEstablishBaseline({ status: 'passed' })).toBe(true);
    expect(mgr.shouldEstablishBaseline({ status: 'explored' })).toBe(true);
    expect(mgr.shouldEstablishBaseline({ status: 'failed' })).toBe(false);
    expect(mgr.shouldEstablishBaseline({ status: 'inconclusive' })).toBe(false);
    expect(mgr.shouldEstablishBaseline({ status: 'needs_assertion' })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════
// CP.6: TestPlan (P2) → BaselineManager (P4) pipeline
// ═════════════════════════════════════════════════════════════

describe('CP.6: TestPlan (P2) → BaselineManager (P4)', () => {
  let mock: MockBaselineStore;
  let mgr: BaselineManager;

  beforeEach(() => {
    mock = new MockBaselineStore();
    mgr = new BaselineManager({ baselineStore: mock });
  });

  it('compareWithBaseline returns inconclusive on first run (no existing baseline)', async () => {
    const delta = await mgr.compareWithBaseline(makeTraceSummary(), {
      runId: 'run_first',
      projectId: 'test',
      targetKind: 'physical',
      deviceModel: 'iPhone14,8',
      iosVersion: '18.2.1',
      scenario: 'launch_cold',
    });

    expect(delta.summary).toBe('inconclusive');
    expect(delta.deltas).toEqual({});
  });

  it('compareWithBaseline returns delta after establishing baseline', async () => {
    await mgr.establishBaseline(makeTraceSummary({ launchDurationMs: 1500, memoryPeakMB: 100 }), {
      projectId: 'test',
      targetKind: 'physical',
      deviceModel: 'iPhone14,8',
      iosVersion: '18.2.1',
      scenario: 'launch_cold',
      runId: 'run_001',
    });

    const delta = await mgr.compareWithBaseline(
      makeTraceSummary({ launchDurationMs: 1650, memoryPeakMB: 110 }),
      {
        runId: 'run_002',
        projectId: 'test',
        targetKind: 'physical',
        deviceModel: 'iPhone14,8',
        iosVersion: '18.2.1',
        scenario: 'launch_cold',
      },
    );

    expect(delta).not.toBeNull();
    expect(delta?.baselineId).toBeDefined();
    expect(delta?.deltas.launchDurationMs).toBe(150);
    expect(delta?.deltas.memoryPeakMB).toBe(10);
  });

  it('domain isolation: physical key vs simulator key are independent domains', async () => {
    await mgr.establishBaseline(makeTraceSummary(), {
      projectId: 'test',
      targetKind: 'physical',
      deviceModel: 'iPhone14,8',
      iosVersion: '18.2.1',
      scenario: 'launch_cold',
      runId: 'run_phys',
    });

    const delta = await mgr.compareWithBaseline(makeTraceSummary(), {
      runId: 'run_sim',
      projectId: 'test',
      targetKind: 'simulator',
      deviceModel: 'iPhone 16 Pro',
      iosVersion: '18.2',
      scenario: 'launch_cold',
    });

    // Different targetKind → different key → no baseline found → inconclusive
    expect(delta.summary).toBe('inconclusive');
    expect(delta.deltas).toEqual({});
  });
});

// ═════════════════════════════════════════════════════════════
// CP.7: RunStep + Evidence → FailureExplainer
// ═════════════════════════════════════════════════════════════

describe('CP.7: RunStep (P3) → FailureExplainer (P4)', () => {
  it('identifies session_not_found as device_issue or env_issue', async () => {
    const explainer = new FailureExplainer();
    const steps: RunStep[] = [fixtureRunStep()];

    const explanation = await explainer.explain({
      runId: 'run_err_001',
      status: 'failed',
      projectProfileRef: 'projects/test/project-profile.json',
      steps,
      targetKind: 'physical',
      evidence: [],
    });

    expect(explanation).toBeDefined();
    expect(['device_issue', 'env_issue', 'inconclusive']).toContain(explanation.explanationType);
    expect(explanation.evidence.length).toBeGreaterThan(0);
  });

  it('identifies crash signals as product_regression', async () => {
    const explainer = new FailureExplainer();
    const steps: RunStep[] = [
      fixtureRunStep({ result: { success: false, error: 'SIGABRT: app crashed' } }),
    ];

    const explanation = await explainer.explain({
      runId: 'run_sigabrt',
      status: 'failed',
      projectProfileRef: 'projects/test/project-profile.json',
      steps,
      targetKind: 'physical',
      evidence: [],
    });

    expect(explanation.explanationType).toBe('product_regression');
    expect(explanation.confidence).toBe('medium');
  });

  it('returns inconclusive for unknown errors (R5)', async () => {
    const explainer = new FailureExplainer();
    const steps: RunStep[] = [
      fixtureRunStep({ result: { success: false, error: 'some random error' } }),
    ];

    const explanation = await explainer.explain({
      runId: 'run_random',
      status: 'failed',
      projectProfileRef: 'projects/test/project-profile.json',
      steps,
      targetKind: 'physical',
      evidence: [],
    });

    expect(explanation.explanationType).toBe('inconclusive');
    expect(explanation.confidence).toBe('low');
  });
});

// ═════════════════════════════════════════════════════════════
// CP.8: P1 Store + P4 Report → three-part report
// ═════════════════════════════════════════════════════════════

describe('CP.8: createStoreCore (P1) + ReportSynthesizer (P4)', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'cp8-'));
  });

  afterEach(() => rmSync(testRoot, { recursive: true, force: true }));

  it('creates store records via createStoreCore + Drizzle (P1→P4)', async () => {
    const { db, driver } = createStoreCore(join(testRoot, 'store.db'));
    await driver.migrate();

    const projectHash = `cp8-${Date.now()}`;
    await db.insert(schema.projects).values({
      projectHash,
      workspacePath: '/tmp/cp8-workspace',
    });

    const rows = await db.select().from(schema.projects);
    expect(rows.some((r) => r.projectHash === projectHash)).toBe(true);
  });

  it('ReportSynthesizer generates three-part report for simulator run', async () => {
    const artifacts: ArtifactEntry[] = [
      fixtureArtifactEntry('ss_001'),
      fixtureArtifactEntry('tree_001', { type: 'uitree', path: '/tmp/tree.xml' }),
    ];

    const synthesizer = new ReportSynthesizer({
      runId: 'run_cp8_001',
      status: 'failed',
      projectProfileRef: 'projects/test-hash/project-profile.json',
      device: {
        udid: '00008110-0012690901C1401E',
        name: 'iPhone 14 Plus',
        model: 'iPhone14,8',
        osVersion: '18.2.1',
        targetKind: 'simulator',
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
      },
      execution: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalSteps: 2,
        completedSteps: 0,
        failedSteps: 2,
        skippedSteps: 0,
        durationMs: 5000,
        targetKind: 'simulator',
        backendUsed: 'appium',
        deviceId: '00008110-0012690901C1401E',
      },
      cases: [],
      metrics: {
        launchDurationMs: 2340,
        memoryPeakMB: 87,
        hangCount: 0,
        fpsApproximate: 60,
      },
      environment: {
        targetKind: 'simulator',
        representativeOfPhysicalDevice: false,
        comparisonScope: 'simulator_only',
        hostFingerprint: 'macOS-15.2-arm64',
        xcodeVersion: '26.5',
      },
      artifactRefs: ['ss_001', 'tree_001'],
      allArtifacts: artifacts,
      steps: [fixtureRunStep({ result: { success: false, error: 'session timeout' } })],
    });

    const result = synthesizer.synthesizeResult();
    expect(result.runId).toBe('run_cp8_001');
    expect(result.status).toBe('failed');
    expect(result.environment?.targetKind).toBe('simulator');

    const artifactIndex = synthesizer.synthesizeArtifactIndex();
    expect(artifactIndex.artifacts).toHaveLength(2);

    const summary = synthesizer.synthesizeSummary();
    expect(summary).toContain('run_cp8_001');
    expect(summary).toContain('iPhone 14 Plus');

    const writeDir = join(testRoot, 'runs', 'run_cp8_001');
    const paths = await synthesizer.write(writeDir);
    expect(paths.resultPath).toContain('result.json');
    expect(paths.artifactIndexPath).toContain('artifact-index.json');
    expect(paths.summaryPath).toContain('summary.md');
  });
});
