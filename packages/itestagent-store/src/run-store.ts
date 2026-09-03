import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { parseArtifactIndex, parseRunResult, parseValidatedRunBundle } from 'itestagent-contracts';
import type { ArtifactIndex, RunResult } from 'itestagent-contracts';
import { resolveStoreRoot } from './bootstrap.js';
import type { DbClient } from './db.js';
import { RunWriter, measureRunArtifactPath } from './run-writer.js';
import { runArtifacts, runCases, runSteps, runs } from './schema.js';
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
  /** Begin the only writer allowed to publish one run bundle. */
  beginRun(input: {
    runId: string;
    projectHash?: string;
    targetKind: 'physical' | 'simulator';
    backend?: string;
    parentRunId?: string;
  }): Promise<RunWriter>;

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
  ): Promise<Array<{ runId: string; status: string; profileRef: string }>>;

  /** Insert a new run record into the SQLite `runs` table. */
  insertRun(record: Omit<NewRun, 'id'>): Promise<void>;

  /** Rebuild missing SQLite indexes from result-marked, structurally valid bundles. */
  reconcile(): Promise<{
    recovered: string[];
    incomplete: string[];
    corrupted: string[];
    legacy: string[];
  }>;
}

async function indexCommittedRun(
  db: DbClient,
  runId: string,
  result: RunResult,
  artifactIndex: ArtifactIndex,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(runCases).where(eq(runCases.runId, runId));
    await tx.delete(runArtifacts).where(eq(runArtifacts.runId, runId));
    if (result.cases.length > 0) {
      await tx.insert(runCases).values(
        result.cases.map((testCase) => ({
          runId,
          caseId: testCase.caseId,
          status: testCase.status,
        })),
      );
    }
    if (artifactIndex.artifacts.length > 0) {
      await tx.insert(runArtifacts).values(
        artifactIndex.artifacts.map((artifact) => ({
          runId,
          artifactId: artifact.id,
          type: artifact.type,
          path: artifact.path,
          relatedStep: artifact.relatedStep,
          relatedCase: artifact.relatedCase,
        })),
      );
    }
    await tx.update(runs).set({ status: result.status }).where(eq(runs.runId, runId));
  });
}

function remainsInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
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
    async beginRun(input): Promise<RunWriter> {
      const writer = await RunWriter.begin(input.runId, join(root, 'runs'), {
        async checkpoint(steps): Promise<void> {
          await db.delete(runSteps).where(eq(runSteps.runId, input.runId));
          if (steps.length > 0) {
            await db.insert(runSteps).values(
              steps.map((step) => ({
                runId: input.runId,
                stepId: step.stepId,
                sequence: step.sequence,
                caseId: step.caseId,
                status: step.status,
                action: step.action,
              })),
            );
          }
        },
        async committed(commit): Promise<void> {
          await indexCommittedRun(db, input.runId, commit.result, commit.artifactIndex);
        },
      });
      try {
        await db
          .insert(runs)
          .values({
            runId: input.runId,
            projectHash: input.projectHash,
            targetKind: input.targetKind,
            backend: input.backend,
            status: 'incomplete',
            parentRunId: input.parentRunId,
          })
          .onConflictDoUpdate({
            target: runs.runId,
            set: { status: 'incomplete', backend: input.backend, parentRunId: input.parentRunId },
          });
        return writer;
      } catch (error) {
        writer.abort();
        throw error;
      }
    },
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
    ): Promise<Array<{ runId: string; status: string; profileRef: string }>> {
      // Load all run directories from the runs folder and return success/fail
      // data for historical comparison in failure explanation.
      const runsDir = join(root, 'runs');
      const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      const results: Array<{ runId: string; status: string; profileRef: string }> = [];
      for (const dirId of dirs) {
        try {
          const resultPath = join(runsDir, dirId, 'result.json');
          const raw = readFileSync(resultPath, 'utf-8');
          const parsed = parseRunResult(JSON.parse(raw));
          if (!parsed.projectProfileRef) continue;
          results.push({
            runId: dirId,
            status: parsed.status,
            profileRef: parsed.projectProfileRef,
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

    async reconcile() {
      const recovered: string[] = [];
      const incomplete: string[] = [];
      const corrupted: string[] = [];
      const legacy: string[] = [];
      const runsRoot = join(root, 'runs');
      const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const runId = entry.name;
        const runDir = join(runsRoot, runId);
        if (!existsSync(join(runDir, 'result.json'))) {
          incomplete.push(runId);
          continue;
        }
        try {
          if (!existsSync(join(runDir, 'summary.md'))) throw new Error('summary.md is missing');
          const rawResult = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'));
          if (
            typeof rawResult !== 'object' ||
            rawResult === null ||
            (rawResult as { schemaVersion?: unknown }).schemaVersion !== '3.0'
          ) {
            legacy.push(runId);
            continue;
          }
          const bundle = parseValidatedRunBundle({
            plan: JSON.parse(readFileSync(join(runDir, 'plan.yaml'), 'utf8')),
            steps: JSON.parse(readFileSync(join(runDir, 'steps.json'), 'utf8')),
            result: rawResult,
            artifactIndex: JSON.parse(readFileSync(join(runDir, 'artifact-index.json'), 'utf8')),
          });
          for (const artifact of bundle.artifactIndex.artifacts) {
            const artifactPath = resolve(runDir, artifact.path);
            if (
              !artifact.path.startsWith('artifacts/') ||
              !remainsInside(join(runDir, 'artifacts'), artifactPath)
            ) {
              throw new Error(`unsafe artifact path: ${artifact.path}`);
            }
            const measured = await measureRunArtifactPath(
              artifactPath,
              artifact.type,
              join(runDir, 'artifacts'),
            );
            if (artifact.sha256 !== measured.sha256 || artifact.sizeBytes !== measured.sizeBytes) {
              throw new Error(`artifact integrity mismatch: ${artifact.id}`);
            }
          }
          await db
            .insert(runs)
            .values({
              runId,
              projectHash: undefined,
              targetKind: bundle.result.execution.targetKind,
              backend: bundle.result.execution.backendUsed,
              status: 'incomplete',
            })
            .onConflictDoUpdate({
              target: runs.runId,
              set: {
                targetKind: bundle.result.execution.targetKind,
                backend: bundle.result.execution.backendUsed,
              },
            });
          await db.delete(runSteps).where(eq(runSteps.runId, runId));
          if (bundle.steps.steps.length > 0) {
            await db.insert(runSteps).values(
              bundle.steps.steps.map((step) => ({
                runId,
                stepId: step.stepId,
                sequence: step.sequence,
                caseId: step.caseId,
                status: step.status,
                action: step.action,
              })),
            );
          }
          await indexCommittedRun(db, runId, bundle.result, bundle.artifactIndex);
          recovered.push(runId);
        } catch {
          corrupted.push(runId);
          await db.update(runs).set({ status: 'corrupted' }).where(eq(runs.runId, runId));
        }
      }
      return { recovered, incomplete, corrupted, legacy };
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

// B37 (guide §10): legacy result read path via the compatibility reader.
export function parseLegacyRunResult(raw: unknown): { ok: boolean } {
  const migrated = migrateResultV1(raw);
  return { ok: migrated.ok };
}
import { migrateResultV1 } from 'itestagent-contracts/migrations';
