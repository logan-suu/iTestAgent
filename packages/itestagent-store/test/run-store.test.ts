import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db.js';
import { createRunStore } from '../src/run-store.js';
import { projects, runs as runsTable } from '../src/schema.js';
import { createStoreDriver } from '../src/store-driver.js';

describe('RunStore', () => {
  let testRoot: string;
  let db: ReturnType<typeof createDb>;

  async function insertProject(hash?: string): Promise<string> {
    const projectHash = hash ?? `abc${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await db.insert(projects).values({
      projectHash,
      workspacePath: '/test/project',
    });
    return projectHash;
  }

  beforeEach(async () => {
    testRoot = join(
      tmpdir(),
      `itestagent-runstore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testRoot, 'db'), { recursive: true });
    mkdirSync(join(testRoot, 'runs'), { recursive: true });

    const driver = createStoreDriver(join(testRoot, 'db', 'itestagent.db'));
    await driver.migrate();
    db = createDb(join(testRoot, 'db', 'itestagent.db'));
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('findById', () => {
    it('returns undefined for non-existent run', async () => {
      const store = createRunStore(db, testRoot);
      const run = await store.findById('nonexistent-run');
      expect(run).toBeUndefined();
    });

    it('returns the run record after insertRun', async () => {
      const store = createRunStore(db, testRoot);
      const hash = await insertProject();
      await store.insertRun({
        runId: 'run-001',
        projectHash: hash,
        targetKind: 'simulator',
        status: 'passed',
      });

      const run = await store.findById('run-001');
      expect(run).toBeDefined();
      expect(run?.runId).toBe('run-001');
      expect(run?.status).toBe('passed');
      expect(run?.targetKind).toBe('simulator');
    });
  });

  describe('findLatest', () => {
    it('returns undefined when no runs exist', async () => {
      const store = createRunStore(db, testRoot);
      const run = await store.findLatest();
      expect(run).toBeUndefined();
    });

    it('returns most recent run sorted by createdAt', async () => {
      const store = createRunStore(db, testRoot);
      const hash = await insertProject();
      await store.insertRun({
        runId: 'run-old',
        projectHash: hash,
        targetKind: 'physical',
        status: 'passed',
      });
      await db
        .update(runsTable)
        .set({ createdAt: '2026-01-01T00:00:00Z' })
        .where(eq(runsTable.runId, 'run-old'));
      await store.insertRun({
        runId: 'run-new',
        projectHash: hash,
        targetKind: 'simulator',
        status: 'failed',
      });
      await db
        .update(runsTable)
        .set({ createdAt: '2026-06-01T00:00:00Z' })
        .where(eq(runsTable.runId, 'run-new'));

      const latest = await store.findLatest();
      expect(latest).toBeDefined();
      expect(latest?.runId).toBe('run-new');
    });
  });

  describe('findByStatus', () => {
    it('returns runs matching the given status', async () => {
      const store = createRunStore(db, testRoot);
      const hash = await insertProject();
      await store.insertRun({
        runId: 'run-failed-1',
        projectHash: hash,
        targetKind: 'physical',
        status: 'failed',
      });
      await store.insertRun({
        runId: 'run-passed',
        projectHash: hash,
        targetKind: 'simulator',
        status: 'passed',
      });
      await store.insertRun({
        runId: 'run-failed-2',
        projectHash: hash,
        targetKind: 'physical',
        status: 'failed',
      });

      const failed = await store.findByStatus('failed');
      expect(failed.length).toBe(2);
      expect(failed.map((r) => r.runId).sort()).toEqual(['run-failed-1', 'run-failed-2']);
    });

    it('returns empty array for unmatched status', async () => {
      const store = createRunStore(db, testRoot);
      const result = await store.findByStatus('passed');
      expect(result).toEqual([]);
    });
  });

  describe('getRunDir', () => {
    it('returns the filesystem path for a run', () => {
      const store = createRunStore(db, testRoot);
      const dir = store.getRunDir('run-abc');
      expect(dir).toBe(join(testRoot, 'runs', 'run-abc'));
    });
  });

  describe('loadRunResult', () => {
    it('loads and parses a valid result.json', async () => {
      const store = createRunStore(db, testRoot);
      const runDir = store.getRunDir('run-001');
      mkdirSync(runDir, { recursive: true });

      const resultJson = {
        schemaVersion: '2.0',
        runId: 'run-001',
        status: 'failed',
        projectProfileRef: 'projects/abc123/project-profile.json',
        device: {
          udid: '00008110-001234567890001E',
          name: 'iPhone 15',
          model: 'iPhone15,4',
          osVersion: '18.2',
          targetKind: 'physical',
        },
        execution: {
          totalSteps: 3,
          completedSteps: 2,
          failedSteps: 1,
          skippedSteps: 0,
          durationMs: 5000,
          startTime: '2026-07-30T10:00:00.000Z',
          endTime: '2026-07-30T10:00:05.000Z',
          targetKind: 'physical',
          backendUsed: 'appium',
          deviceId: '00008110-001234567890001E',
        },
        cases: [],
        metrics: {},
        environment: {
          targetKind: 'physical',
          representativeOfPhysicalDevice: true,
          comparisonScope: 'physical_only',
        },
        artifactRefs: [],
      };

      writeFileSync(join(runDir, 'result.json'), JSON.stringify(resultJson));

      const loaded = await store.loadRunResult('run-001');
      expect(loaded.runId).toBe('run-001');
      expect(loaded.status).toBe('failed');
      expect(loaded.device.targetKind).toBe('physical');
    });

    it('throws on malformed result.json', async () => {
      const store = createRunStore(db, testRoot);
      const runDir = store.getRunDir('run-bad');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'result.json'), '{invalid json');

      await expect(store.loadRunResult('run-bad')).rejects.toThrow();
    });
  });

  describe('loadArtifactIndex', () => {
    it('loads and parses a valid artifact-index.json', async () => {
      const store = createRunStore(db, testRoot);
      const runDir = store.getRunDir('run-001');
      mkdirSync(runDir, { recursive: true });

      const artifactIndex = {
        schemaVersion: '2.0',
        runId: 'run-001',
        artifacts: [
          {
            id: 'artifact-1',
            type: 'screenshot',
            path: 'artifacts/screenshot-1.png',
            redactionStatus: 'safe',
          },
        ],
        collectionOutcomes: [
          {
            type: 'screenshot',
            status: 'collected',
            reasonCode: 'collected',
            artifactId: 'artifact-1',
          },
        ],
      };

      writeFileSync(join(runDir, 'artifact-index.json'), JSON.stringify(artifactIndex));

      const loaded = await store.loadArtifactIndex('run-001');
      expect(loaded.runId).toBe('run-001');
      expect(loaded.artifacts.length).toBe(1);
      expect(loaded.artifacts[0]?.type).toBe('screenshot');
    });
  });

  describe('getPreviousRuns', () => {
    it('returns empty array when no runs exist', async () => {
      const store = createRunStore(db, testRoot);
      const result = await store.getPreviousRuns('any-run');
      expect(result).toEqual([]);
    });

    it('returns previous run data for historical comparison', async () => {
      const store = createRunStore(db, testRoot);
      const runDir1 = store.getRunDir('run-001');
      mkdirSync(runDir1, { recursive: true });
      writeFileSync(
        join(runDir1, 'result.json'),
        JSON.stringify({
          schemaVersion: '2.0',
          runId: 'run-001',
          status: 'passed',
          projectProfileRef: 'projects/abc/profile.json',
          device: { udid: 'A', name: 'X', model: 'M', osVersion: '18', targetKind: 'physical' },
          execution: {
            totalSteps: 1,
            completedSteps: 1,
            failedSteps: 0,
            skippedSteps: 0,
            durationMs: 1000,
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-01-01T00:00:01Z',
            targetKind: 'physical',
            backendUsed: 'appium',
            deviceId: 'A',
          },
          cases: [],
          metrics: {},
          environment: {
            targetKind: 'physical',
            representativeOfPhysicalDevice: true,
            comparisonScope: 'physical_only',
          },
          artifactRefs: [],
        }),
      );

      const result = await store.getPreviousRuns('run-002');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some((r) => r.runId === 'run-001')).toBe(true);
    });
  });

  describe('insertRun', () => {
    it('inserts a run record and makes it queryable', async () => {
      const store = createRunStore(db, testRoot);
      const hash = await insertProject();

      await store.insertRun({
        runId: 'insert-test',
        projectHash: hash,
        targetKind: 'physical',
        status: 'created',
      });

      const found = await store.findById('insert-test');
      expect(found).toBeDefined();
      expect(found?.runId).toBe('insert-test');
    });

    it('supports parentRunId for rerun linking (US-16.1 AC3)', async () => {
      const store = createRunStore(db, testRoot);
      const hash = await insertProject();

      await store.insertRun({
        runId: 'original-run',
        projectHash: hash,
        targetKind: 'physical',
        status: 'failed',
      });
      await store.insertRun({
        runId: 'rerun-1',
        projectHash: hash,
        targetKind: 'physical',
        status: 'created',
        parentRunId: 'original-run',
      });

      const rerun = await store.findById('rerun-1');
      expect(rerun).toBeDefined();
      expect(rerun?.parentRunId).toBe('original-run');
    });
  });

  describe('filesystem seam (B07)', () => {
    it('insertRun + getRunDir agree on the on-disk run location', async () => {
      const hash = await insertProject();
      const store = createRunStore(db, testRoot);
      await store.insertRun({
        runId: 'run-seam-1',
        projectHash: hash,
        targetKind: 'physical',
        status: 'created',
      });

      const runDir = store.getRunDir('run-seam-1');
      expect(runDir.startsWith(join(testRoot, 'runs'))).toBe(true);
      mkdirSync(runDir, { recursive: true });

      const loaded = await store.findById('run-seam-1');
      expect(loaded?.runId).toBe('run-seam-1');
    });
  });
});
