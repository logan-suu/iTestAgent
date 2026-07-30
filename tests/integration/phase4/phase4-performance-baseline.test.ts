/**
 * Phase 4 integration — Performance + Baseline pipeline.
 *
 * Verifies the chain from TraceSummary through BaselineManager and BaselineStore.
 * Includes ADR-011 domain isolation for physical vs simulator baselines.
 *
 * P0: BaselineManager → BaselineStore → BaselineDelta
 * P1: ADR-011 cross-domain guard
 */
import { describe, expect, it } from 'bun:test';

import type {
  BaselineDelta,
  BaselineListFilter,
  BaselineRecord,
  BaselineStore,
  TraceSummary,
} from 'itestagent-contracts';
import {
  BaselineDeltaSchema,
  BaselineRecordSchema,
  TraceSummarySchema,
  buildBaselineKey,
  parseBaselineKey,
} from 'itestagent-contracts';

import { BaselineManager } from 'itestagent-engine';

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

// ─── Fixtures ────────────────────────────────────────────────

function makeTraceSummary(overrides?: Partial<TraceSummary>): TraceSummary {
  return {
    launchDurationMs: 1200,
    memoryPeakMB: 256,
    hangCount: 2,
    fpsApproximate: 55,
    approximate: true,
    hitchesSummary: { totalHitchDurationMs: 150 },
    ...overrides,
  };
}

const NOW = new Date().toISOString();

// ─── Tests ───────────────────────────────────────────────────

describe('Phase 4 Performance + Baseline', () => {
  // ── Baseline Key Construction ─────────────────────────────

  it('buildBaselineKey produces deterministic composite key', () => {
    const key1 = buildBaselineKey({
      projectId: 'myapp',
      targetKind: 'physical',
      deviceModel: 'iPhone16,2',
      iosVersion: '18.2',
      scenario: 'login-smoke',
    });

    const key2 = buildBaselineKey({
      projectId: 'myapp',
      targetKind: 'physical',
      deviceModel: 'iPhone16,2',
      iosVersion: '18.2',
      scenario: 'login-smoke',
    });

    expect(key1).toBe(key2);
    expect(key1).toBe('myapp|physical|iPhone16,2|18.2|login-smoke');
  });

  it('parseBaselineKey round-trips correctly', () => {
    const key = 'myapp|physical|iPhone16,2|18.2|login-smoke';
    const parsed = parseBaselineKey(key);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.projectId).toBe('myapp');
    expect(parsed.targetKind).toBe('physical');
    expect(parsed.deviceModel).toBe('iPhone16,2');
    expect(parsed.iosVersion).toBe('18.2');
    expect(parsed.scenario).toBe('login-smoke');

    const rebuilt = buildBaselineKey(parsed);
    expect(rebuilt).toBe(key);
  });

  // ── BaselineManager.establishBaseline ─────────────────────

  it('BaselineManager establishes baseline on first success', async () => {
    const store = new MockBaselineStore();
    const mgr = new BaselineManager({ baselineStore: store });

    const traceSummary = makeTraceSummary();
    const context = {
      projectId: 'myapp',
      targetKind: 'physical' as const,
      deviceModel: 'iPhone16,2',
      iosVersion: '18.2',
      scenario: 'login-smoke',
      runId: 'run-001',
    };

    const record = await mgr.establishBaseline(traceSummary, context);

    expect(BaselineRecordSchema.safeParse(record).success).toBe(true);
    expect(record.key).toBe('myapp|physical|iPhone16,2|18.2|login-smoke');
    expect(record.targetKind).toBe('physical');
    expect(record.launchDurationMs).toBe(1200);
    expect(record.memoryPeakMB).toBe(256);
    expect(record.hangCount).toBe(2);
    expect(record.fpsApproximate).toBe(55);
    expect(record.approximate).toBe(true);
    expect(record.updatedFromRun).toBe('run-001');
    expect(record.reachableRuns).toContain('run-001');

    const retrieved = await store.get(record.key);
    expect(retrieved).not.toBeNull();
    if (!retrieved) return;
    expect(retrieved.launchDurationMs).toBe(1200);
  });

  it('BaselineManager shouldEstablishBaseline returns true for passed/explored', () => {
    const store = new MockBaselineStore();
    const mgr = new BaselineManager({ baselineStore: store });

    expect(mgr.shouldEstablishBaseline({ status: 'passed' })).toBe(true);
    expect(mgr.shouldEstablishBaseline({ status: 'explored' })).toBe(true);
  });

  it('BaselineManager shouldEstablishBaseline returns false for failed/crashed', () => {
    const store = new MockBaselineStore();
    const mgr = new BaselineManager({ baselineStore: store });

    expect(mgr.shouldEstablishBaseline({ status: 'failed' })).toBe(false);
    expect(mgr.shouldEstablishBaseline({ status: 'inconclusive' })).toBe(false);
    expect(mgr.shouldEstablishBaseline({ status: 'needs_assertion' })).toBe(false);
    expect(mgr.shouldEstablishBaseline({ status: 'flaky' })).toBe(false);
  });

  // ── BaselineManager.compareWithBaseline ───────────────────

  it('BaselineManager.compareWithBaseline detects regressions', async () => {
    const store = new MockBaselineStore();

    const baseline: BaselineRecord = {
      schemaVersion: 2,
      key: 'myapp|physical|iPhone16,2|18.2|login-smoke',
      targetKind: 'physical',
      launchDurationMs: 1000,
      memoryPeakMB: 200,
      hangCount: 0,
      approximate: true,
      updatedFromRun: 'run-001',
      createdAt: NOW,
      updatedAt: NOW,
      reachableRuns: ['run-001'],
    };

    await store.save(baseline);
    const mgr = new BaselineManager({ baselineStore: store });

    const delta = await mgr.compareWithBaseline(
      makeTraceSummary({ launchDurationMs: 1200, memoryPeakMB: 250 }),
      {
        runId: 'run-002',
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'login-smoke',
      },
    );

    expect(delta.baselineId).toBe(baseline.key);
    expect(delta.summary).toBe('regressed');
    expect(delta.deltas.launchDurationMs).toBe(200);
    expect(delta.deltas.memoryPeakMB).toBe(50);
    expect(BaselineDeltaSchema.safeParse(delta).success).toBe(true);
  });

  it('BaselineManager.compareWithBaseline detects improvement', async () => {
    const store = new MockBaselineStore();

    const baseline: BaselineRecord = {
      schemaVersion: 2,
      key: 'myapp|simulator|iPhone17,1|18.2|login-smoke',
      targetKind: 'simulator',
      launchDurationMs: 1500,
      memoryPeakMB: 300,
      approximate: true,
      updatedFromRun: 'run-001',
      createdAt: NOW,
      updatedAt: NOW,
      reachableRuns: ['run-001'],
      comparisonScope: 'simulator_only',
      representativeOfPhysicalDevice: false,
      hostFingerprint: 'macOS-15.2-arm64',
      xcodeVersion: '16.5',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    };

    await store.save(baseline);
    const mgr = new BaselineManager({ baselineStore: store });

    const delta = await mgr.compareWithBaseline(
      makeTraceSummary({ launchDurationMs: 1200, memoryPeakMB: 250 }),
      {
        runId: 'run-002',
        projectId: 'myapp',
        targetKind: 'simulator',
        deviceModel: 'iPhone17,1',
        iosVersion: '18.2',
        scenario: 'login-smoke',
      },
    );

    expect(delta.baselineId).toBe(baseline.key);
    expect(delta.summary).toBe('improved');
    expect(delta.deltas.launchDurationMs).toBe(-300);
    expect(delta.deltas.memoryPeakMB).toBe(-50);
    expect(delta.targetKind).toBe('simulator');
  });

  it('BaselineManager.compareWithBaseline returns inconclusive when no baseline exists', async () => {
    const store = new MockBaselineStore();
    const mgr = new BaselineManager({ baselineStore: store });

    const delta = await mgr.compareWithBaseline(makeTraceSummary(), {
      runId: 'run-first',
      projectId: 'myapp',
      targetKind: 'physical',
      deviceModel: 'iPhone16,2',
      iosVersion: '18.2',
      scenario: 'login-smoke',
    });

    expect(delta.baselineId).toContain('myapp|physical');
    expect(delta.summary).toBe('inconclusive');
    expect(delta.deltas).toEqual({});
  });

  // ── ADR-011 Domain Isolation ──────────────────────────────

  it('Physical and simulator baselines are domain-isolated (ADR-011 §6)', async () => {
    const store = new MockBaselineStore();
    const mgr = new BaselineManager({ baselineStore: store });

    // Establish physical baseline
    const physicalRecord = await mgr.establishBaseline(
      makeTraceSummary({ launchDurationMs: 1000 }),
      {
        projectId: 'myapp',
        targetKind: 'physical',
        deviceModel: 'iPhone16,2',
        iosVersion: '18.2',
        scenario: 'login-smoke',
        runId: 'run-physical',
      },
    );

    // Establish simulator baseline (different domain)
    const simRecord = await mgr.establishBaseline(makeTraceSummary({ launchDurationMs: 1500 }), {
      projectId: 'myapp',
      targetKind: 'simulator',
      deviceModel: 'iPhone17,1',
      iosVersion: '18.2',
      scenario: 'login-smoke',
      runId: 'run-sim',
      hostFingerprint: 'macOS-15.2-arm64',
      xcodeVersion: '16.5',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    });

    expect(physicalRecord.key).not.toBe(simRecord.key);
    expect(physicalRecord.targetKind).toBe('physical');
    expect(simRecord.targetKind).toBe('simulator');
    expect(simRecord.representativeOfPhysicalDevice).toBe(false);
    expect(simRecord.comparisonScope).toBe('simulator_only');

    // Both persist independently
    const allPhysical = await store.list({ targetKind: 'physical' });
    const allSim = await store.list({ targetKind: 'simulator' });

    expect(allPhysical.length).toBe(1);
    expect(allSim.length).toBe(1);
    const phys = allPhysical[0];
    const sim = allSim[0];
    if (!phys || !sim) return;
    expect(phys.key).toContain('physical');
    expect(sim.key).toContain('simulator');
  });

  // ── TraceSummary Schema Validation ────────────────────────

  it('TraceSummarySchema accepts valid summary with approximate markers', () => {
    const summary = makeTraceSummary();
    const parsed = TraceSummarySchema.parse(summary);
    expect(parsed.approximate).toBe(true);
    expect(parsed.launchDurationMs).toBe(1200);
  });

  it('TraceSummarySchema rejects negative fpsApproximate', () => {
    const result = TraceSummarySchema.safeParse(makeTraceSummary({ fpsApproximate: -5 }));
    expect(result.success).toBe(false);
  });

  // ── BaselineRecord Schema Validation ──────────────────────

  it('BaselineRecordSchema validates simulator metadata', () => {
    const record: BaselineRecord = {
      schemaVersion: 2,
      key: 'myapp|simulator|iPhone17,1|18.2|smoke',
      targetKind: 'simulator',
      launchDurationMs: 1200,
      approximate: true,
      updatedFromRun: 'run-001',
      createdAt: NOW,
      updatedAt: NOW,
      reachableRuns: ['run-001'],
      comparisonScope: 'simulator_only',
      representativeOfPhysicalDevice: false,
      hostFingerprint: 'macOS-15.2-arm64',
      xcodeVersion: '16.5',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    };

    const parsed = BaselineRecordSchema.parse(record);
    expect(parsed.targetKind).toBe('simulator');
    expect(parsed.hostFingerprint).toBe('macOS-15.2-arm64');
  });

  it('BaselineRecordSchema rejects unknown extra fields (strict)', () => {
    const result = BaselineRecordSchema.safeParse({
      schemaVersion: 2,
      key: 'myapp|physical|iPhone16,2|18.0|smoke',
      targetKind: 'physical',
      approximate: true,
      updatedFromRun: 'run-001',
      createdAt: NOW,
      updatedAt: NOW,
      reachableRuns: ['run-001'],
      fakeField: 'should-not-be-here',
    });
    expect(result.success).toBe(false);
  });

  // ── BaselineManager.acceptNewBaseline ─────────────────────

  it('BaselineManager.acceptNewBaseline updates run tracking', async () => {
    const store = new MockBaselineStore();
    const mgr = new BaselineManager({ baselineStore: store });

    const ctx = {
      projectId: 'myapp',
      targetKind: 'physical' as const,
      deviceModel: 'iPhone16,2',
      iosVersion: '18.2',
      scenario: 'login-smoke',
    };

    // First establish
    const established = await mgr.establishBaseline(makeTraceSummary({ launchDurationMs: 1000 }), {
      ...ctx,
      runId: 'run-001',
    });

    const updated = await mgr.acceptNewBaseline('run-002', established.key, true);
    expect(updated).not.toBeNull();
    expect(updated?.updatedFromRun).toBe('run-002');
    expect(updated?.reachableRuns).toContain('run-001');
    expect(updated?.reachableRuns).toContain('run-002');

    const record = await store.get(buildBaselineKey(ctx));
    expect(record?.updatedFromRun).toBe('run-002');
    expect(record?.reachableRuns.length).toBe(2);
  });
});
