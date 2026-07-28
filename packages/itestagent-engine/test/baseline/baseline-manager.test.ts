import { beforeEach, describe, expect, test } from 'bun:test';
import type {
  BaselineDelta,
  BaselineListFilter,
  BaselineRecord,
  BaselineStore,
  RunStatus,
  TraceSummary,
} from 'itestagent-contracts';
import { buildBaselineKey, parseBaselineKey } from 'itestagent-contracts';
import {
  type BaselineKeyContext,
  BaselineManager,
  type CompareBaselineContext,
  type EstablishBaselineContext,
} from '../../src/baseline/baseline-manager.js';

// ─── Mock BaselineStore ─────────────────────────────────────

/**
 * In-memory Map-based mock of BaselineStore for unit testing.
 * Tracks saved records so we can verify callbacks.
 */
class MockBaselineStore implements BaselineStore {
  private store = new Map<string, BaselineRecord>();
  /** All records passed to save(), in order. */
  readonly saved: BaselineRecord[] = [];

  async get(key: string): Promise<BaselineRecord | null> {
    return this.store.get(key) ?? null;
  }

  async save(record: BaselineRecord): Promise<void> {
    this.store.set(record.key, record);
    this.saved.push(record);
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

  /** Convenience: seed a baseline into the store before compare tests. */
  seed(record: BaselineRecord): void {
    this.store.set(record.key, record);
  }
}

// ─── Helpers ────────────────────────────────────────────────

function makeBaselineManager(): {
  manager: BaselineManager;
  store: MockBaselineStore;
} {
  const store = new MockBaselineStore();
  const manager = new BaselineManager({ baselineStore: store });
  return { manager, store };
}

/** Default context for key building. */
function makeKeyContext(overrides?: Partial<BaselineKeyContext>): BaselineKeyContext {
  return {
    projectId: 'com.example.myapp',
    targetKind: 'physical',
    deviceModel: 'iPhone15,2',
    iosVersion: '18.2',
    scenario: 'login-smoke',
    ...overrides,
  };
}

/** Default context for establishing a baseline. */
function makeEstablishContext(
  overrides?: Partial<EstablishBaselineContext>,
): EstablishBaselineContext {
  return {
    ...makeKeyContext(),
    runId: 'run-001',
    ...overrides,
  };
}

/** Default context for comparing against baseline. */
function makeCompareContext(overrides?: Partial<CompareBaselineContext>): CompareBaselineContext {
  return {
    runId: 'run-002',
    ...makeKeyContext(),
    ...overrides,
  };
}

/** Create a TraceSummary with specified fields, zeros as default sentinel. */
function makeSummary(fields: Partial<TraceSummary> = {}): TraceSummary {
  return { ...fields };
}

/** Create a valid baseline record for seeding the store. */
function makeBaselineRecord(overrides?: Partial<BaselineRecord>): BaselineRecord {
  const keyContext = makeKeyContext();
  const key = buildBaselineKey(keyContext);
  return {
    schemaVersion: 2 as const,
    key,
    targetKind: 'physical',
    launchDurationMs: 1200,
    memoryPeakMB: 85,
    hangCount: 2,
    hitchesSummary: 5,
    fpsApproximate: 58.5,
    approximate: true,
    updatedFromRun: 'run-001',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    reachableRuns: ['run-001'],
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────
//  shouldEstablishBaseline
// ────────────────────────────────────────────────────────────

describe('shouldEstablishBaseline', () => {
  let manager: BaselineManager;

  beforeEach(() => {
    manager = makeBaselineManager().manager;
  });

  // AC2: First successful run establishes baseline
  test('returns true for status "passed" (AC2: first successful run)', () => {
    expect(manager.shouldEstablishBaseline({ status: 'passed' })).toBe(true);
  });

  test('returns true for status "explored" (exploration completed without failure)', () => {
    expect(manager.shouldEstablishBaseline({ status: 'explored' })).toBe(true);
  });

  // AC5: crash / functional failure / execution failure do NOT establish
  test('returns false for status "failed" (AC5: functional failure)', () => {
    expect(manager.shouldEstablishBaseline({ status: 'failed' })).toBe(false);
  });

  test('returns false for status "inconclusive"', () => {
    expect(manager.shouldEstablishBaseline({ status: 'inconclusive' })).toBe(false);
  });

  test('returns false for status "needs_assertion"', () => {
    expect(manager.shouldEstablishBaseline({ status: 'needs_assertion' })).toBe(false);
  });

  test('returns false for status "flaky"', () => {
    expect(manager.shouldEstablishBaseline({ status: 'flaky' })).toBe(false);
  });

  test('returns false for status "blocked"', () => {
    expect(manager.shouldEstablishBaseline({ status: 'blocked' })).toBe(false);
  });

  // Unknown/unlisted status → default case returns false
  test('returns false for unknown status "crashed" (not in standard RunStatus)', () => {
    expect(manager.shouldEstablishBaseline({ status: 'crashed' as RunStatus })).toBe(false);
  });

  test('returns false for unknown status "execution_failed" (not in standard RunStatus)', () => {
    expect(
      manager.shouldEstablishBaseline({
        status: 'execution_failed' as RunStatus,
      }),
    ).toBe(false);
  });

  // All known RunStatus values are covered (exhaustiveness via switch)
  test('all known RunStatus values produce a boolean result', () => {
    const allStatuses: RunStatus[] = [
      'passed',
      'failed',
      'explored',
      'inconclusive',
      'needs_assertion',
      'flaky',
      'blocked',
    ];
    for (const status of allStatuses) {
      const result = manager.shouldEstablishBaseline({ status });
      expect(typeof result).toBe('boolean');
    }
  });
});

// ────────────────────────────────────────────────────────────
//  buildBaselineKeyFromContext
// ────────────────────────────────────────────────────────────

describe('buildBaselineKeyFromContext', () => {
  let manager: BaselineManager;

  beforeEach(() => {
    manager = makeBaselineManager().manager;
  });

  test('returns correct composite key format', () => {
    const ctx = makeKeyContext();
    const key = manager.buildBaselineKeyFromContext(ctx);
    expect(key).toBe('com.example.myapp|physical|iPhone15,2|18.2|login-smoke');
  });

  test('key is parseable back to components', () => {
    const ctx = makeKeyContext();
    const key = manager.buildBaselineKeyFromContext(ctx);
    const parsed = parseBaselineKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed?.projectId).toBe(ctx.projectId);
    expect(parsed?.targetKind).toBe(ctx.targetKind);
    expect(parsed?.deviceModel).toBe(ctx.deviceModel);
    expect(parsed?.iosVersion).toBe(ctx.iosVersion);
    expect(parsed?.scenario).toBe(ctx.scenario);
  });

  test('sanitizes pipe characters in components', () => {
    const ctx = makeKeyContext({ projectId: 'com.example|app' });
    const key = manager.buildBaselineKeyFromContext(ctx);
    expect(key).toContain('com.example-app');
    expect(key).not.toContain('com.example|app|');
  });

  test('produces distinct keys for different scenarios', () => {
    const ctxA = makeKeyContext({ scenario: 'login-smoke' });
    const ctxB = makeKeyContext({ scenario: 'checkout-smoke' });
    const keyA = manager.buildBaselineKeyFromContext(ctxA);
    const keyB = manager.buildBaselineKeyFromContext(ctxB);
    expect(keyA).not.toBe(keyB);
  });

  test('produces distinct keys for different targetKinds', () => {
    const keyA = makeKeyContext({ targetKind: 'physical' });
    const keyB = makeKeyContext({ targetKind: 'simulator' });
    expect(manager.buildBaselineKeyFromContext(keyA)).not.toBe(
      manager.buildBaselineKeyFromContext(keyB),
    );
  });
});

// ────────────────────────────────────────────────────────────
//  establishBaseline
// ────────────────────────────────────────────────────────────

describe('establishBaseline', () => {
  test('creates baseline record with all metric fields from TraceSummary', async () => {
    const { manager, store } = makeBaselineManager();
    const summary = makeSummary({
      launchDurationMs: 1500,
      memoryPeakMB: 92,
      hangCount: 3,
      hitchesSummary: { count: 7 },
      fpsApproximate: 59.1,
      approximate: false,
    });
    const ctx = makeEstablishContext({ runId: 'run-001' });

    const record = await manager.establishBaseline(summary, ctx);

    expect(record.launchDurationMs).toBe(1500);
    expect(record.memoryPeakMB).toBe(92);
    expect(record.hangCount).toBe(3);
    expect(record.hitchesSummary).toEqual({ count: 7 });
    expect(record.fpsApproximate).toBe(59.1);
    expect(record.approximate).toBe(false);
  });

  test('sets updatedFromRun and reachableRuns correctly', async () => {
    const { manager } = makeBaselineManager();
    const summary = makeSummary();
    const ctx = makeEstablishContext({ runId: 'run-abc' });

    const record = await manager.establishBaseline(summary, ctx);

    expect(record.updatedFromRun).toBe('run-abc');
    expect(record.reachableRuns).toEqual(['run-abc']);
  });

  test('sets createdAt and updatedAt timestamps', async () => {
    const { manager } = makeBaselineManager();
    const summary = makeSummary();
    const ctx = makeEstablishContext();

    const before = new Date().toISOString();
    const record = await manager.establishBaseline(summary, ctx);
    const after = new Date().toISOString();

    expect(record.createdAt >= before).toBe(true);
    expect(record.createdAt <= after).toBe(true);
    expect(record.updatedAt).toBe(record.createdAt);
  });

  test('returns BaselineRecord with schemaVersion=2', async () => {
    const { manager } = makeBaselineManager();
    const record = await manager.establishBaseline(makeSummary(), makeEstablishContext());
    expect(record.schemaVersion).toBe(2);
  });

  test('for physical targetKind: does NOT include simulator-only fields', async () => {
    const { manager } = makeBaselineManager();
    const ctx = makeEstablishContext({ targetKind: 'physical' });
    const record = await manager.establishBaseline(makeSummary(), ctx);

    expect(record.targetKind).toBe('physical');
    expect(record.comparisonScope).toBeUndefined();
    expect(record.representativeOfPhysicalDevice).toBeUndefined();
    expect(record.hostFingerprint).toBeUndefined();
    expect(record.xcodeVersion).toBeUndefined();
    expect(record.runtimeIdentifier).toBeUndefined();
  });

  test('for simulator targetKind: populates simulator-only fields (ADR-011 §6)', async () => {
    const { manager } = makeBaselineManager();
    const ctx = makeEstablishContext({
      targetKind: 'simulator',
      hostFingerprint: 'macOS-15.2-arm64',
      xcodeVersion: '16.2',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    });
    const record = await manager.establishBaseline(makeSummary(), ctx);

    expect(record.targetKind).toBe('simulator');
    expect(record.comparisonScope).toBe('simulator_only');
    expect(record.representativeOfPhysicalDevice).toBe(false);
    expect(record.hostFingerprint).toBe('macOS-15.2-arm64');
    expect(record.xcodeVersion).toBe('16.2');
    expect(record.runtimeIdentifier).toBe('com.apple.CoreSimulator.SimRuntime.iOS-18-2');
  });

  test('for simulator: simulator-only metadata is optional (can be undefined)', async () => {
    const { manager } = makeBaselineManager();
    const ctx = makeEstablishContext({
      targetKind: 'simulator',
      // No hostFingerprint, xcodeVersion, or runtimeIdentifier
    });
    const record = await manager.establishBaseline(makeSummary(), ctx);

    expect(record.targetKind).toBe('simulator');
    expect(record.comparisonScope).toBe('simulator_only');
    expect(record.representativeOfPhysicalDevice).toBe(false);
    expect(record.hostFingerprint).toBeUndefined();
    expect(record.xcodeVersion).toBeUndefined();
    expect(record.runtimeIdentifier).toBeUndefined();
  });

  test('callback/save verification: mock store receives the record', async () => {
    const { manager, store } = makeBaselineManager();
    const summary = makeSummary({ launchDurationMs: 999 });
    const ctx = makeEstablishContext();

    await manager.establishBaseline(summary, ctx);

    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.launchDurationMs).toBe(999);
    expect(store.saved[0]?.updatedFromRun).toBe(ctx.runId);
  });

  test('approximate defaults to true when TraceSummary does not set it', async () => {
    const { manager } = makeBaselineManager();
    // approximate not set in summary
    const summary: TraceSummary = { launchDurationMs: 1000 };
    const record = await manager.establishBaseline(summary, makeEstablishContext());
    expect(record.approximate).toBe(true);
  });

  test('approximate is false when TraceSummary explicitly sets it', async () => {
    const { manager } = makeBaselineManager();
    const summary = makeSummary({ approximate: false });
    const record = await manager.establishBaseline(summary, makeEstablishContext());
    expect(record.approximate).toBe(false);
  });

  test('derives key correctly from context fields', async () => {
    const { manager } = makeBaselineManager();
    const ctx = makeEstablishContext({
      projectId: 'com.acme.v2',
      targetKind: 'simulator',
      deviceModel: 'iPhone16,1',
      iosVersion: '17.5',
      scenario: 'onboarding',
    });
    const record = await manager.establishBaseline(makeSummary(), ctx);

    const expectedKey = buildBaselineKey({
      projectId: 'com.acme.v2',
      targetKind: 'simulator',
      deviceModel: 'iPhone16,1',
      iosVersion: '17.5',
      scenario: 'onboarding',
    });
    expect(record.key).toBe(expectedKey);
  });
});

// ────────────────────────────────────────────────────────────
//  compareWithBaseline
// ────────────────────────────────────────────────────────────

describe('compareWithBaseline', () => {
  test('returns inconclusive when no baseline exists in store', async () => {
    const { manager } = makeBaselineManager();
    const summary = makeSummary({ launchDurationMs: 1000 });
    const ctx = makeCompareContext();

    const delta = await manager.compareWithBaseline(summary, ctx);

    expect(delta.summary).toBe('inconclusive');
    expect(delta.deltas).toEqual({});
    expect(delta.baselineId).toBe(buildBaselineKey(makeKeyContext()));
    expect(delta.runId).toBe(ctx.runId);
    expect(delta.targetKind).toBe(ctx.targetKind);
  });

  // ── unchanged (all deltas zero) ──────────────────────────

  test('returns unchanged when launchDurationMs is same as baseline', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ launchDurationMs: 1200 }));

    const summary = makeSummary({ launchDurationMs: 1200 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.launchDurationMs).toBe(0);
    expect(delta.summary).toBe('unchanged');
  });

  test('returns unchanged when all metrics match baseline exactly', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(
      makeBaselineRecord({
        launchDurationMs: 1200,
        memoryPeakMB: 85,
        hangCount: 2,
        fpsApproximate: 58.5,
        hitchesSummary: 5,
      }),
    );

    const summary = makeSummary({
      launchDurationMs: 1200,
      memoryPeakMB: 85,
      hangCount: 2,
      fpsApproximate: 58.5,
      hitchesSummary: 5,
    });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.launchDurationMs).toBe(0);
    expect(delta.deltas.memoryPeakMB).toBe(0);
    expect(delta.deltas.hangCount).toBe(0);
    expect(delta.deltas.fpsApproximate).toBe(0);
    expect(delta.deltas.hitches).toBe('unchanged');
    expect(delta.summary).toBe('unchanged');
  });

  // ── improved: positive-favor metrics ─────────────────────

  test('returns improved when launchDurationMs decreases (current < baseline)', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ launchDurationMs: 2000 }));

    const summary = makeSummary({ launchDurationMs: 1500 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.launchDurationMs).toBe(-500);
    expect(delta.summary).toBe('improved');
  });

  test('returns improved when memoryPeakMB decreases', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ memoryPeakMB: 100 }));

    const summary = makeSummary({ memoryPeakMB: 80 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.memoryPeakMB).toBe(-20);
    expect(delta.summary).toBe('improved');
  });

  test('returns improved when hangCount decreases', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ hangCount: 5 }));

    const summary = makeSummary({ hangCount: 2 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.hangCount).toBe(-3);
    expect(delta.summary).toBe('improved');
  });

  test('returns improved when fpsApproximate increases (higher FPS)', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ fpsApproximate: 55 }));

    const summary = makeSummary({ fpsApproximate: 60 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.fpsApproximate).toBe(5);
    expect(delta.summary).toBe('improved');
  });

  // ── regressed: positive-favor metrics ────────────────────

  test('returns regressed when launchDurationMs increases (current > baseline)', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ launchDurationMs: 1000 }));

    const summary = makeSummary({ launchDurationMs: 1600 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.launchDurationMs).toBe(600);
    expect(delta.summary).toBe('regressed');
  });

  test('returns regressed when memoryPeakMB increases', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ memoryPeakMB: 80 }));

    const summary = makeSummary({ memoryPeakMB: 110 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.memoryPeakMB).toBe(30);
    expect(delta.summary).toBe('regressed');
  });

  test('returns regressed when hangCount increases', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ hangCount: 1 }));

    const summary = makeSummary({ hangCount: 4 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.hangCount).toBe(3);
    expect(delta.summary).toBe('regressed');
  });

  test('returns regressed when fpsApproximate decreases (FPS drop = regression)', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ fpsApproximate: 60 }));

    const summary = makeSummary({ fpsApproximate: 50 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.fpsApproximate).toBe(-10);
    expect(delta.summary).toBe('regressed');
  });

  // ── hitches: comparison tests ────────────────────────────

  test('hitches: "unchanged" when both are same number', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ hitchesSummary: 3 }));

    const summary = makeSummary({ hitchesSummary: 3 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.hitches).toBe('unchanged');
  });

  test('hitches: "improved" when baseline has hitches but current has fewer', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ hitchesSummary: 10 }));

    const summary = makeSummary({ hitchesSummary: 4 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.hitches).toBe('improved');
  });

  test('hitches: "regressed" when new hitches appear (current > baseline)', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ hitchesSummary: 2 }));

    const summary = makeSummary({ hitchesSummary: 8 });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.hitches).toBe('regressed');
  });

  test('hitches: "inconclusive" when non-numeric (non-comparable format)', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ hitchesSummary: 'some-string-summary' }));

    const summary = makeSummary({ hitchesSummary: 'different-string' });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.hitches).toBe('inconclusive');
  });

  test('hitches: omitted from deltas when both absent', async () => {
    const { manager, store } = makeBaselineManager();
    // Hitches missing from both — both undefined
    store.seed(makeBaselineRecord({ hitchesSummary: undefined }));
    const summary: TraceSummary = {}; // no hitchesSummary

    const delta = await manager.compareWithBaseline(summary, makeCompareContext());
    expect(delta.deltas.hitches).toBeUndefined();
  });

  // ── summary: worst-case across ALL metrics ──────────────

  test('summary reflects worst-case: one regressed metric → "regressed" regardless of improvements', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(
      makeBaselineRecord({
        launchDurationMs: 2000,
        memoryPeakMB: 100,
        hangCount: 5,
        fpsApproximate: 55,
      }),
    );

    // launchDurationMs improved, but hangCount regressed
    const summary = makeSummary({
      launchDurationMs: 1500, // improved (-500)
      memoryPeakMB: 90, // improved (-10)
      hangCount: 8, // regressed (+3)
      fpsApproximate: 56, // improved (+1)
    });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.summary).toBe('regressed');
  });

  test('summary: any improvement and no regression → "improved"', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(
      makeBaselineRecord({
        launchDurationMs: 2000,
        memoryPeakMB: 100,
        hangCount: 5,
      }),
    );

    // launchDurationMs improved, others unchanged
    const summary = makeSummary({
      launchDurationMs: 1500,
      memoryPeakMB: 100,
      hangCount: 5,
    });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.summary).toBe('improved');
  });

  test('summary: all metrics unchanged → "unchanged"', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(
      makeBaselineRecord({
        launchDurationMs: 2000,
        memoryPeakMB: 100,
      }),
    );

    const summary = makeSummary({
      launchDurationMs: 2000,
      memoryPeakMB: 100,
    });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.summary).toBe('unchanged');
  });

  // ── metadata fields ─────────────────────────────────────

  test('returns correct runId, comparedAt, and targetKind in BaselineDelta', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ launchDurationMs: 1000 }));

    const ctx = makeCompareContext({ runId: 'run-xyz', targetKind: 'simulator' });
    const delta = await manager.compareWithBaseline(makeSummary({ launchDurationMs: 1000 }), ctx);

    expect(delta.runId).toBe('run-xyz');
    expect(delta.targetKind).toBe('simulator');
    expect(typeof delta.comparedAt).toBe('string');
    // Should be a valid ISO 8601 timestamp
    expect(new Date(delta.comparedAt).toISOString()).toBe(delta.comparedAt);
  });

  // ── missing metrics skipped ─────────────────────────────

  test('only computes deltas for metrics present in BOTH current and baseline', async () => {
    const { manager, store } = makeBaselineManager();
    // baseline has launchDurationMs and memoryPeakMB
    store.seed(
      makeBaselineRecord({
        launchDurationMs: 1200,
        memoryPeakMB: 85,
        hangCount: undefined,
        fpsApproximate: undefined,
      }),
    );

    // current has launchDurationMs and hangCount (memoryPeakMB missing)
    const summary: TraceSummary = {
      launchDurationMs: 1300, // +100 → regression
      hangCount: 3,
      // memoryPeakMB intentionally omitted
    };
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    // launchDurationMs is in both → included
    expect(delta.deltas.launchDurationMs).toBe(100);
    // memoryPeakMB is in baseline but NOT in current → skipped
    expect(delta.deltas.memoryPeakMB).toBeUndefined();
    // hangCount is in current but NOT in baseline → skipped
    expect(delta.deltas.hangCount).toBeUndefined();
  });

  test('hitches: omitted when current hitchesSummary is null', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(makeBaselineRecord({ hitchesSummary: 5 }));

    const summary = makeSummary({ hitchesSummary: null as unknown });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());
    expect(delta.deltas.hitches).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
//  acceptNewBaseline
// ────────────────────────────────────────────────────────────

describe('acceptNewBaseline', () => {
  test('returns null when no existing baseline for the key', async () => {
    const { manager } = makeBaselineManager();
    const result = await manager.acceptNewBaseline(
      'run-002',
      'nonexistent|physical|iPhone|18.0|smoke',
    );
    expect(result).toBeNull();
  });

  test('prepends runId to reachableRuns array', async () => {
    const { manager, store } = makeBaselineManager();
    const original = makeBaselineRecord({
      reachableRuns: ['run-001'],
      key: buildBaselineKey(makeKeyContext()),
    });
    store.seed(original);

    const result = await manager.acceptNewBaseline('run-002', original.key);

    expect(result).not.toBeNull();
    expect(result?.reachableRuns).toEqual(['run-002', 'run-001']);
  });

  test('prepends multiple runs over time', async () => {
    const { manager, store } = makeBaselineManager();
    const original = makeBaselineRecord({
      reachableRuns: ['run-001'],
      key: buildBaselineKey(makeKeyContext()),
    });
    store.seed(original);

    await manager.acceptNewBaseline('run-002', original.key);
    const result = await manager.acceptNewBaseline('run-003', original.key);

    expect(result?.reachableRuns).toEqual(['run-003', 'run-002', 'run-001']);
  });

  test('bumps updatedAt timestamp', async () => {
    const { manager, store } = makeBaselineManager();
    const original = makeBaselineRecord({
      updatedAt: '2026-07-01T00:00:00.000Z',
      key: buildBaselineKey(makeKeyContext()),
    });
    store.seed(original);

    const accepted = await manager.acceptNewBaseline('run-002', original.key);

    expect(accepted).not.toBeNull();
    if (!accepted) throw new Error('expected non-null');
    expect(accepted.updatedAt).not.toBe('2026-07-01T00:00:00.000Z');
    expect(new Date(accepted.updatedAt).getTime()).toBeGreaterThan(
      new Date('2026-07-01T00:00:00.000Z').getTime(),
    );
  });

  test('preserves all other baseline fields', async () => {
    const { manager, store } = makeBaselineManager();
    const original = makeBaselineRecord({
      key: buildBaselineKey(makeKeyContext()),
      launchDurationMs: 1500,
      memoryPeakMB: 92,
      hangCount: 3,
      fpsApproximate: 59.1,
      hitchesSummary: { count: 7 },
      approximate: false,
      targetKind: 'simulator',
      comparisonScope: 'simulator_only',
      representativeOfPhysicalDevice: false,
      hostFingerprint: 'macOS-15.2-arm64',
    });
    store.seed(original);

    const result = await manager.acceptNewBaseline('run-002', original.key);

    expect(result?.schemaVersion).toBe(2);
    expect(result?.key).toBe(original.key);
    expect(result?.targetKind).toBe('simulator');
    expect(result?.launchDurationMs).toBe(1500);
    expect(result?.memoryPeakMB).toBe(92);
    expect(result?.hangCount).toBe(3);
    expect(result?.fpsApproximate).toBe(59.1);
    expect(result?.hitchesSummary).toEqual({ count: 7 });
    expect(result?.approximate).toBe(false);
    expect(result?.comparisonScope).toBe('simulator_only');
    expect(result?.representativeOfPhysicalDevice).toBe(false);
    expect(result?.hostFingerprint).toBe('macOS-15.2-arm64');
    expect(result?.createdAt).toBe(original.createdAt);
  });

  test('updates updatedFromRun to the new runId', async () => {
    const { manager, store } = makeBaselineManager();
    const original = makeBaselineRecord({
      updatedFromRun: 'run-001',
      key: buildBaselineKey(makeKeyContext()),
    });
    store.seed(original);

    const result = await manager.acceptNewBaseline('run-002', original.key);

    expect(result?.updatedFromRun).toBe('run-002');
  });

  test('saves updated record via mock store', async () => {
    const { manager, store } = makeBaselineManager();
    const original = makeBaselineRecord({
      key: buildBaselineKey(makeKeyContext()),
    });
    store.seed(original);
    const saveCountBefore = store.saved.length;

    await manager.acceptNewBaseline('run-newsave', original.key);

    expect(store.saved.length).toBe(saveCountBefore + 1);
    expect(store.saved[store.saved.length - 1]?.updatedFromRun).toBe('run-newsave');
  });

  test('subsequent get returns the updated record', async () => {
    const { manager, store } = makeBaselineManager();
    const original = makeBaselineRecord({
      key: buildBaselineKey(makeKeyContext()),
    });
    store.seed(original);

    await manager.acceptNewBaseline('run-002', original.key);

    const stored = await store.get(original.key);
    expect(stored?.updatedFromRun).toBe('run-002');
    expect(stored?.reachableRuns).toContain('run-002');
  });
});

// ────────────────────────────────────────────────────────────
//  Edge cases & cross-cutting
// ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('establish then compare: end-to-end baseline lifecycle', async () => {
    const { manager } = makeBaselineManager();

    // Establish
    const summary1 = makeSummary({
      launchDurationMs: 2000,
      memoryPeakMB: 100,
      hangCount: 3,
      fpsApproximate: 55,
      hitchesSummary: 5,
    });
    await manager.establishBaseline(summary1, makeEstablishContext({ runId: 'run-001' }));

    // Compare: same values → unchanged
    const delta1 = await manager.compareWithBaseline(
      summary1,
      makeCompareContext({ runId: 'run-002' }),
    );
    expect(delta1.summary).toBe('unchanged');

    // Compare: better values → improved
    const betterSummary = makeSummary({
      launchDurationMs: 1800,
      memoryPeakMB: 90,
      hangCount: 2,
      fpsApproximate: 58,
      hitchesSummary: 3,
    });
    const delta2 = await manager.compareWithBaseline(
      betterSummary,
      makeCompareContext({ runId: 'run-003' }),
    );
    expect(delta2.summary).toBe('improved');

    // Compare: worse values → regressed
    const worseSummary = makeSummary({
      launchDurationMs: 2500,
      memoryPeakMB: 120,
      hangCount: 6,
      fpsApproximate: 48,
    });
    const delta3 = await manager.compareWithBaseline(
      worseSummary,
      makeCompareContext({ runId: 'run-004' }),
    );
    expect(delta3.summary).toBe('regressed');

    // Accept new baseline
    const key = buildBaselineKey(makeKeyContext());
    const accepted = await manager.acceptNewBaseline('run-004', key);
    expect(accepted?.reachableRuns).toContain('run-004');
  });

  test('multiple scenarios in same project are isolated by key', async () => {
    const { manager, store } = makeBaselineManager();

    // Establish baseline for login-smoke
    const loginCtx = makeEstablishContext({ scenario: 'login-smoke' });
    const loginSummary = makeSummary({ launchDurationMs: 1200 });
    await manager.establishBaseline(loginSummary, loginCtx);

    // Establish baseline for checkout-smoke
    const checkoutCtx = makeEstablishContext({ scenario: 'checkout-smoke' });
    const checkoutSummary = makeSummary({ launchDurationMs: 800 });
    await manager.establishBaseline(checkoutSummary, checkoutCtx);

    // Compare login against its own baseline
    const loginDelta = await manager.compareWithBaseline(
      makeSummary({ launchDurationMs: 1300 }),
      makeCompareContext({ scenario: 'login-smoke', runId: 'run-compare-login' }),
    );
    expect(loginDelta.summary).toBe('regressed'); // 1200 → 1300

    // Compare checkout against its own baseline
    const checkoutDelta = await manager.compareWithBaseline(
      makeSummary({ launchDurationMs: 750 }),
      makeCompareContext({ scenario: 'checkout-smoke', runId: 'run-compare-checkout' }),
    );
    expect(checkoutDelta.summary).toBe('improved'); // 800 → 750
  });

  test('compareWithBaseline with zero baseline values (zero is not undefined)', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(
      makeBaselineRecord({
        launchDurationMs: 0,
        memoryPeakMB: 0,
        hangCount: 0,
        fpsApproximate: 0,
      }),
    );

    const summary = makeSummary({
      launchDurationMs: 100,
      memoryPeakMB: 50,
      hangCount: 1,
      fpsApproximate: 30,
    });
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    // All are regressions from 0
    expect(delta.deltas.launchDurationMs).toBe(100);
    expect(delta.deltas.memoryPeakMB).toBe(50);
    expect(delta.deltas.hangCount).toBe(1);
    expect(delta.deltas.fpsApproximate).toBe(30); // FPS improved from 0
    // launchDurationMs, memoryPeakMB, hangCount regressed; fpsApproximate improved
    // → overall 'regressed' (worst-case wins)
    expect(delta.summary).toBe('regressed');
  });

  test('TraceSummary with only some metrics: only those are compared', async () => {
    const { manager, store } = makeBaselineManager();
    store.seed(
      makeBaselineRecord({
        launchDurationMs: 1200,
        memoryPeakMB: 85,
        hangCount: 2,
        fpsApproximate: 58.5,
        hitchesSummary: 5,
      }),
    );

    // Only provide launchDurationMs in current
    const summary: TraceSummary = { launchDurationMs: 1000 };
    const delta = await manager.compareWithBaseline(summary, makeCompareContext());

    expect(delta.deltas.launchDurationMs).toBe(-200);
    expect(delta.deltas.memoryPeakMB).toBeUndefined();
    expect(delta.deltas.hangCount).toBeUndefined();
    expect(delta.deltas.fpsApproximate).toBeUndefined();
    expect(delta.deltas.hitches).toBeUndefined();
    expect(delta.summary).toBe('improved');
  });

  test('acceptNewBaseline preserves reachableRuns when updated multiple times for same key', async () => {
    const { manager, store } = makeBaselineManager();
    const key = buildBaselineKey(makeKeyContext());
    const original = makeBaselineRecord({ key, reachableRuns: ['run-A'] });
    store.seed(original);

    const r1 = await manager.acceptNewBaseline('run-B', key);
    expect(r1?.reachableRuns).toEqual(['run-B', 'run-A']);

    const r2 = await manager.acceptNewBaseline('run-C', key);
    expect(r2?.reachableRuns).toEqual(['run-C', 'run-B', 'run-A']);
  });

  test('buildBaselineKeyFromContext handles special characters via sanitization', async () => {
    const { manager } = makeBaselineManager();
    const ctx: BaselineKeyContext = {
      projectId: 'com.example|test',
      targetKind: 'physical',
      deviceModel: 'iPhone 15,2',
      iosVersion: '18.2',
      scenario: 'login|smoke',
    };
    const key = manager.buildBaselineKeyFromContext(ctx);

    // Pipes should be replaced with hyphens
    expect(key).not.toContain('com.example|test');
    expect(key).toContain('com.example-test');
    expect(key).not.toContain('login|smoke');
    expect(key).toContain('login-smoke');

    const parsed = parseBaselineKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed?.projectId).toBe('com.example-test');
    expect(parsed?.scenario).toBe('login-smoke');
  });
});
