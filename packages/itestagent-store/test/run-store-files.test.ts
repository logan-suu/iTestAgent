/**
 * run-store-files.test.ts — B07 store-artifacts batch (promotion guide
 * §11.3, AGENTS.md §5 run directory contract).
 *
 * Locks the filesystem side of RunStore: the runs/<runId>/ directory layout,
 * result.json / artifact-index.json round-trips through the published
 * contracts, and graceful skipping of malformed run directories.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../src/db.js';
import { createRunStore } from '../src/run-store.js';
import { createStoreDriver } from '../src/store-driver.js';

describe('RunStore filesystem layout (B07)', () => {
  let testRoot: string;
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    testRoot = join(
      tmpdir(),
      `itestagent-b07-runfiles-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testRoot, 'db'), { recursive: true });
    mkdirSync(join(testRoot, 'runs'), { recursive: true });
    const driver = createStoreDriver(join(testRoot, 'db', 'itestagent.db'));
    void driver.migrate().catch(() => {});
    db = createDb(join(testRoot, 'db', 'itestagent.db'));
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  function makeStore() {
    return createRunStore(db, testRoot);
  }

  it('resolves runs/<runId> as the run directory', () => {
    const store = makeStore();
    expect(store.getRunDir('run_abc')).toBe(join(testRoot, 'runs', 'run_abc'));
  });

  /**
   * Minimal RunResult satisfying the published contract (B03 schema).
   */
  function makeResult(
    runId: string,
    status: 'passed' | 'failed',
    targetKind: 'physical' | 'simulator',
  ) {
    const env =
      targetKind === 'simulator'
        ? { representativeOfPhysicalDevice: false, comparisonScope: 'simulator_only' as const }
        : { representativeOfPhysicalDevice: true, comparisonScope: 'physical_only' as const };
    return {
      schemaVersion: '3.0',
      runId,
      status,
      projectProfileRef: '~/.itestagent/projects/abc/project-profile.json',
      device: {
        udid: 'UDID-FIXTURE-0001',
        name: 'iPhone',
        model: 'iPhone 14 Plus',
        osVersion: '18.2.1',
        targetKind,
      },
      execution: {
        mode: 'device_backend',
        totalSteps: 3,
        completedSteps: status === 'passed' ? 3 : 2,
        failedSteps: status === 'passed' ? 0 : 1,
        skippedSteps: 0,
        durationMs: 60_000,
        startTime: '2026-08-25T00:00:00.000Z',
        endTime: '2026-08-25T00:01:00.000Z',
        targetKind,
        backendUsed: 'appium',
        deviceId: 'UDID-FIXTURE-0001',
      },
      cases: [],
      metrics: {},
      environment: { targetKind, ...env },
      artifactRefs: [],
    };
  }

  it('round-trips result.json through parseRunResult', async () => {
    const store = makeStore();
    const runDir = join(testRoot, 'runs', 'run_rt1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'result.json'),
      JSON.stringify(makeResult('run_rt1', 'passed', 'physical')),
    );
    const loaded = await store.loadRunResult('run_rt1');
    expect(loaded.runId).toBe('run_rt1');
    expect(loaded.status).toBe('passed');
  });

  it('round-trips artifact-index.json through parseArtifactIndex', async () => {
    const store = makeStore();
    const runDir = join(testRoot, 'runs', 'run_rt2');
    mkdirSync(join(runDir, 'artifacts'), { recursive: true });
    const index = {
      schemaVersion: '2.0',
      runId: 'run_rt2',
      artifacts: [
        {
          id: 'art-1',
          type: 'screenshot',
          path: 'artifacts/art-1.png',
          redactionStatus: 'raw-local-only',
        },
      ],
      collectionOutcomes: [
        {
          type: 'screenshot',
          status: 'collected',
          reasonCode: 'collected',
          artifactId: 'art-1',
        },
      ],
    };
    writeFileSync(join(runDir, 'artifact-index.json'), JSON.stringify(index));
    const loaded = await store.loadArtifactIndex('run_rt2');
    expect(loaded.artifacts).toHaveLength(1);
    // AGENTS.md §5 contract: the artifacts/ directory lives beside the index.
    expect(existsSync(join(runDir, 'artifacts'))).toBe(true);
  });

  it('getPreviousRuns skips malformed run directories instead of throwing', async () => {
    const store = makeStore();
    const goodDir = join(testRoot, 'runs', 'run_good');
    mkdirSync(goodDir, { recursive: true });
    writeFileSync(
      join(goodDir, 'result.json'),
      JSON.stringify(makeResult('run_good', 'failed', 'simulator')),
    );
    const badDir = join(testRoot, 'runs', 'run_bad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'result.json'), '{ not json');

    const previous = await store.getPreviousRuns('run_current');
    expect(previous.map((entry) => entry.runId)).toContain('run_good');
    expect(previous.map((entry) => entry.runId)).not.toContain('run_bad');
  });
});
