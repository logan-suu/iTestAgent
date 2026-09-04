import { existsSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import {
  isSafeRunId,
  parseArtifactIndex,
  parseRunResult,
  parseValidatedRunBundle,
} from 'itestagent-contracts';
import type { ArtifactIndex, RunBundleDocuments, RunResult, RunStep } from 'itestagent-contracts';
import {
  readPersistedArtifactIndex,
  readPersistedRunResult,
} from 'itestagent-contracts/migrations';
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

  /** Load a complete canonical bundle and verify its artifact integrity. */
  loadRunBundle(runId: string): Promise<RunBundleDocuments>;

  /** Resolve the newest complete canonical bundle, skipping incomplete/corrupted entries. */
  findLatestValidBundle(): Promise<RunBundleDocuments | undefined>;

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
  steps: readonly RunStep[],
): Promise<void> {
  db.transaction((tx) => {
    tx.delete(runSteps).where(eq(runSteps.runId, runId)).run();
    tx.delete(runCases).where(eq(runCases.runId, runId)).run();
    tx.delete(runArtifacts).where(eq(runArtifacts.runId, runId)).run();
    if (steps.length > 0) {
      tx.insert(runSteps)
        .values(
          steps.map((step) => ({
            runId,
            stepId: step.stepId,
            sequence: step.sequence,
            caseId: step.caseId,
            status: step.status,
            action: step.action,
          })),
        )
        .run();
    }
    if (result.cases.length > 0) {
      tx.insert(runCases)
        .values(
          result.cases.map((testCase) => ({
            runId,
            caseId: testCase.caseId,
            status: testCase.status,
          })),
        )
        .run();
    }
    if (artifactIndex.artifacts.length > 0) {
      tx.insert(runArtifacts)
        .values(
          artifactIndex.artifacts.map((artifact) => ({
            runId,
            artifactId: artifact.id,
            type: artifact.type,
            path: artifact.path,
            relatedStep: artifact.relatedStep,
            relatedCase: artifact.relatedCase,
          })),
        )
        .run();
    }
    tx.update(runs)
      .set({ status: result.status, parentRunId: result.parentRunId })
      .where(eq(runs.runId, runId))
      .run();
  });
}

function remainsInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

function assertSafeRunId(runId: string): void {
  if (!isSafeRunId(runId)) {
    throw new Error('unsafe runId');
  }
}

async function loadCanonicalBundle(root: string, runId: string): Promise<RunBundleDocuments> {
  assertSafeRunId(runId);
  const runDir = join(root, 'runs', runId);
  if (!existsSync(join(runDir, 'summary.md'))) throw new Error('summary.md is missing');
  const bundle = parseValidatedRunBundle({
    plan: JSON.parse(readFileSync(join(runDir, 'plan.yaml'), 'utf8')),
    steps: JSON.parse(readFileSync(join(runDir, 'steps.json'), 'utf8')),
    result: JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8')),
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
  return bundle;
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
          db.transaction((tx) => {
            tx.delete(runSteps).where(eq(runSteps.runId, input.runId)).run();
            if (steps.length > 0) {
              tx.insert(runSteps)
                .values(
                  steps.map((step) => ({
                    runId: input.runId,
                    stepId: step.stepId,
                    sequence: step.sequence,
                    caseId: step.caseId,
                    status: step.status,
                    action: step.action,
                  })),
                )
                .run();
            }
          });
        },
        async committed(commit): Promise<void> {
          await indexCommittedRun(
            db,
            input.runId,
            commit.result,
            commit.artifactIndex,
            commit.steps,
          );
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

    async loadRunBundle(runId: string): Promise<RunBundleDocuments> {
      return loadCanonicalBundle(root, runId);
    },

    async findLatestValidBundle(): Promise<RunBundleDocuments | undefined> {
      const runsDir = join(root, 'runs');
      const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
      const candidates = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => ({
            runId: entry.name,
            modifiedAt: await stat(join(runsDir, entry.name, 'result.json'))
              .then((value) => value.mtimeMs)
              .catch(() => -1),
          })),
      );
      candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
      for (const candidate of candidates) {
        if (candidate.modifiedAt < 0) continue;
        try {
          return await loadCanonicalBundle(root, candidate.runId);
        } catch {
          // latest means the newest complete canonical bundle, not a newer broken directory
        }
      }
      return undefined;
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
          RunWriter.recoverStaleLock(runId, runsRoot);
          incomplete.push(runId);
          continue;
        }
        let bundle: ReturnType<typeof parseValidatedRunBundle>;
        try {
          if (!existsSync(join(runDir, 'summary.md'))) throw new Error('summary.md is missing');
          const rawResult = JSON.parse(readFileSync(join(runDir, 'result.json'), 'utf8'));
          const resultRead = readPersistedRunResult(rawResult);
          if (resultRead.ok && resultRead.kind === 'legacy') {
            legacy.push(runId);
            continue;
          }
          if (!resultRead.ok) throw new Error('result compatibility validation failed');
          const rawArtifactIndex = JSON.parse(
            readFileSync(join(runDir, 'artifact-index.json'), 'utf8'),
          );
          const artifactRead = readPersistedArtifactIndex(rawArtifactIndex);
          if (artifactRead.ok && artifactRead.kind === 'legacy') {
            legacy.push(runId);
            continue;
          }
          if (!artifactRead.ok) throw new Error('artifact-index compatibility validation failed');
          bundle = await loadCanonicalBundle(root, runId);
        } catch {
          corrupted.push(runId);
          await db.update(runs).set({ status: 'corrupted' }).where(eq(runs.runId, runId));
          continue;
        }
        db.transaction((tx) => {
          tx.insert(runs)
            .values({
              runId,
              projectHash: undefined,
              targetKind: bundle.result.execution.targetKind,
              backend: bundle.result.execution.backendUsed,
              status: 'incomplete',
              parentRunId: bundle.result.parentRunId,
            })
            .onConflictDoUpdate({
              target: runs.runId,
              set: {
                targetKind: bundle.result.execution.targetKind,
                backend: bundle.result.execution.backendUsed,
                parentRunId: bundle.result.parentRunId,
              },
            })
            .run();
          tx.delete(runSteps).where(eq(runSteps.runId, runId)).run();
          tx.delete(runCases).where(eq(runCases.runId, runId)).run();
          tx.delete(runArtifacts).where(eq(runArtifacts.runId, runId)).run();
          if (bundle.steps.steps.length > 0) {
            tx.insert(runSteps)
              .values(
                bundle.steps.steps.map((step) => ({
                  runId,
                  stepId: step.stepId,
                  sequence: step.sequence,
                  caseId: step.caseId,
                  status: step.status,
                  action: step.action,
                })),
              )
              .run();
          }
          if (bundle.result.cases.length > 0) {
            tx.insert(runCases)
              .values(
                bundle.result.cases.map((testCase) => ({
                  runId,
                  caseId: testCase.caseId,
                  status: testCase.status,
                })),
              )
              .run();
          }
          if (bundle.artifactIndex.artifacts.length > 0) {
            tx.insert(runArtifacts)
              .values(
                bundle.artifactIndex.artifacts.map((artifact) => ({
                  runId,
                  artifactId: artifact.id,
                  type: artifact.type,
                  path: artifact.path,
                  relatedStep: artifact.relatedStep,
                  relatedCase: artifact.relatedCase,
                })),
              )
              .run();
          }
          tx.update(runs).set({ status: bundle.result.status }).where(eq(runs.runId, runId)).run();
        });
        recovered.push(runId);
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
