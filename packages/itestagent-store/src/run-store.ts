import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { parseArtifactIndex, parseRunResult } from 'itestagent-contracts';
import type { ArtifactIndex, RunResult } from 'itestagent-contracts';
import { resolveStoreRoot } from './bootstrap.js';
import type { DbClient } from './db.js';
import { runs } from './schema.js';
import type { NewRun, Run } from './schema.js';

/**
 * High-level query layer for iTestAgent test runs.
 *
 * Wraps Drizzle ORM (SQLite metadata) + filesystem reads (result.json,
 * artifact-index.json) to provide a unified run query API.
 *
 * US-14.1 (explain) + US-16.1 (rerun) — task 5.4.
 */
export interface RunStore {
  /** Look up a run by its id in the SQLite `runs` table. */
  findById(runId: string): Promise<Run | undefined>;

  /** Get the most recently created run. */
  findLatest(): Promise<Run | undefined>;

  /** List runs matching a given status, ordered newest first. */
  findByStatus(status: string, limit?: number): Promise<Run[]>;

  /** Resolve the filesystem directory for a run. */
  getRunDir(runId: string): string;

  /** Load and parse result.json from a run directory. */
  loadRunResult(runId: string): Promise<RunResult>;

  /** Load and parse artifact-index.json from a run directory. */
  loadArtifactIndex(runId: string): Promise<ArtifactIndex>;

  /** Get previous runs (for flaky / historical comparison). */
  getPreviousRuns(
    runId: string,
  ): Promise<Array<{ runId: string; status: string; scenario: string }>>;

  /** Insert a new run record into the SQLite `runs` table. */
  insertRun(record: Omit<NewRun, 'id'>): Promise<void>;
}

/**
 * Create a RunStore instance.
 *
 * @param db - Drizzle ORM instance (from `createDb()`)
 * @param storeRoot - Store root directory (defaults to `~/.itestagent`)
 */
export function createRunStore(db: DbClient, storeRoot?: string): RunStore {
  const root = storeRoot ?? resolveStoreRoot();

  return {
    async findById(runId: string): Promise<Run | undefined> {
      const rows = await db.select().from(runs).where(eq(runs.runId, runId)).limit(1);
      return rows[0];
    },

    async findLatest(): Promise<Run | undefined> {
      const rows = await db.select().from(runs).orderBy(desc(runs.createdAt)).limit(1);
      return rows[0];
    },

    async findByStatus(status: string, limit = 20): Promise<Run[]> {
      return db
        .select()
        .from(runs)
        .where(eq(runs.status, status))
        .orderBy(desc(runs.createdAt))
        .limit(limit);
    },

    getRunDir(runId: string): string {
      return join(root, 'runs', runId);
    },

    async loadRunResult(runId: string): Promise<RunResult> {
      const runDir = this.getRunDir(runId);
      const raw = readFileSync(join(runDir, 'result.json'), 'utf-8');
      return parseRunResult(JSON.parse(raw));
    },

    async loadArtifactIndex(runId: string): Promise<ArtifactIndex> {
      const runDir = this.getRunDir(runId);
      const raw = readFileSync(join(runDir, 'artifact-index.json'), 'utf-8');
      return parseArtifactIndex(JSON.parse(raw));
    },

    async getPreviousRuns(
      _runId: string,
    ): Promise<Array<{ runId: string; status: string; scenario: string }>> {
      // Load all run directories from the runs folder and return success/fail
      // data for historical comparison in failure explanation.
      const runsDir = join(root, 'runs');
      const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      const results: Array<{ runId: string; status: string; scenario: string }> = [];
      for (const dirId of dirs) {
        try {
          const resultPath = join(runsDir, dirId, 'result.json');
          const raw = readFileSync(resultPath, 'utf-8');
          const parsed = parseRunResult(JSON.parse(raw));
          results.push({
            runId: dirId,
            status: parsed.status,
            scenario: parsed.projectProfileRef,
          });
        } catch {
          // Skip malformed run directories
        }
      }
      return results;
    },

    async insertRun(record: Omit<NewRun, 'id'>): Promise<void> {
      await db.insert(runs).values(record);
    },
  };
}

/**
 * Create a RunStore with default store root (~/.itestagent).
 *
 * Convenience factory; accepts the Drizzle database client.
 */
export function createDefaultRunStore(db: DbClient): RunStore {
  return createRunStore(db, resolveStoreRoot());
}
