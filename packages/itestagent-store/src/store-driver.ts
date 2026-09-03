import { Database } from 'bun:sqlite';
import type { StoreDriver } from 'itestagent-contracts';

/**
 * SQL migrations as raw statements — avoids drizzle-kit dependency.
 * Each entry is [name, sql]. Runs only once; idempotent.
 */
const MIGRATIONS: [string, string][] = [
  [
    '001_initial',
    `
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

    CREATE INDEX IF NOT EXISTS idx_runs_project_hash ON runs(project_hash);
    CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
    CREATE INDEX IF NOT EXISTS idx_projects_project_hash ON projects(project_hash);
    `,
  ],
  ['002_parent_run_id', 'ALTER TABLE runs ADD COLUMN parent_run_id TEXT;'],
  [
    '003_run_bundle_indexes',
    `
    CREATE TABLE runs_v3 (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT NOT NULL UNIQUE,
      project_hash    TEXT REFERENCES projects(project_hash),
      target_kind     TEXT NOT NULL CHECK(target_kind IN ('physical', 'simulator')),
      backend         TEXT,
      status          TEXT NOT NULL DEFAULT 'created',
      parent_run_id   TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO runs_v3 (id, run_id, project_hash, target_kind, backend, status, parent_run_id, created_at)
      SELECT id, run_id, project_hash, target_kind, backend, status, parent_run_id, created_at FROM runs;
    DROP TABLE runs;
    ALTER TABLE runs_v3 RENAME TO runs;
    CREATE INDEX idx_runs_project_hash ON runs(project_hash);
    CREATE INDEX idx_runs_run_id ON runs(run_id);
    CREATE TABLE run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      step_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      case_id TEXT,
      status TEXT NOT NULL,
      action TEXT NOT NULL,
      UNIQUE(run_id, step_id),
      UNIQUE(run_id, sequence)
    );
    CREATE TABLE run_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      case_id TEXT NOT NULL,
      status TEXT NOT NULL,
      UNIQUE(run_id, case_id)
    );
    CREATE TABLE run_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      artifact_id TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      related_step TEXT,
      related_case TEXT,
      UNIQUE(run_id, artifact_id)
    );
    CREATE INDEX idx_run_steps_run_id ON run_steps(run_id);
    CREATE INDEX idx_run_cases_run_id ON run_cases(run_id);
    CREATE INDEX idx_run_artifacts_run_id ON run_artifacts(run_id);
    `,
  ],
];

/**
 * Create a StoreDriver backed by a SQLite database.
 *
 * Maintains a single persistent connection for transactional safety.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns StoreDriver implementation
 */
export function createStoreDriver(dbPath: string, existingConnection?: Database): StoreDriver {
  const sqlite = existingConnection ?? new Database(dbPath);
  if (!existingConnection) {
    sqlite.run('PRAGMA journal_mode = WAL');
  }
  sqlite.run('PRAGMA foreign_keys = ON');

  function migrationApplied(name: string): boolean {
    return Boolean(
      sqlite.query('SELECT name FROM _migrations WHERE name = ?').get(name) as {
        name: string;
      } | null,
    );
  }

  function hasRunBundleIndexSchema(): boolean {
    const expectedColumns = {
      runs: [
        'id',
        'run_id',
        'project_hash',
        'target_kind',
        'backend',
        'status',
        'parent_run_id',
        'created_at',
      ],
      run_steps: ['id', 'run_id', 'step_id', 'sequence', 'case_id', 'status', 'action'],
      run_cases: ['id', 'run_id', 'case_id', 'status'],
      run_artifacts: [
        'id',
        'run_id',
        'artifact_id',
        'type',
        'path',
        'related_step',
        'related_case',
      ],
    } as const;
    for (const [table, expected] of Object.entries(expectedColumns)) {
      const columns = sqlite.query(`PRAGMA table_info('${table}')`).all() as Array<{
        name: string;
        notnull: number;
      }>;
      if (
        columns.length !== expected.length ||
        expected.some((name, index) => columns[index]?.name !== name)
      ) {
        return false;
      }
    }
    const projectHash = (
      sqlite.query("PRAGMA table_info('runs')").all() as Array<{
        name: string;
        notnull: number;
      }>
    ).find((column) => column.name === 'project_hash');
    if (projectHash?.notnull !== 0) return false;
    const requiredIndexes = new Set([
      'idx_runs_project_hash',
      'idx_runs_run_id',
      'idx_run_steps_run_id',
      'idx_run_cases_run_id',
      'idx_run_artifacts_run_id',
    ]);
    const indexes = new Set(
      (
        sqlite
          .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_run%'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    return [...requiredIndexes].every((name) => indexes.has(name));
  }

  function applyMigration(name: string, sql: string): void {
    const disablesForeignKeys = name === '003_run_bundle_indexes';
    if (disablesForeignKeys) sqlite.run('PRAGMA foreign_keys = OFF');
    try {
      sqlite.run('BEGIN IMMEDIATE');
      sqlite.run(sql);
      sqlite.run('INSERT INTO _migrations (name) VALUES (?)', [name]);
      sqlite.run('COMMIT');
    } catch (error) {
      try {
        sqlite.run('ROLLBACK');
      } catch {
        // The original migration error remains authoritative.
      }
      throw error;
    } finally {
      if (disablesForeignKeys) sqlite.run('PRAGMA foreign_keys = ON');
    }
  }

  return {
    async migrate(): Promise<void> {
      // Create migrations tracking table
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS _migrations (
          name      TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      for (const [name, sql] of MIGRATIONS) {
        if (!migrationApplied(name)) {
          try {
            applyMigration(name, sql);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const isKnownParentColumnReplay =
              name === '002_parent_run_id' && msg.includes('duplicate column name: parent_run_id');
            const isKnownCompleteRunBundleReplay =
              name === '003_run_bundle_indexes' &&
              msg.includes('already exists') &&
              hasRunBundleIndexSchema();
            if (!isKnownParentColumnReplay && !isKnownCompleteRunBundleReplay) {
              throw err;
            }
            applyMigration(name, 'SELECT 1;');
          }
        }
      }
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      try {
        sqlite.run('BEGIN IMMEDIATE');
        const result = await fn();
        sqlite.run('COMMIT');
        return result;
      } catch (err) {
        try {
          sqlite.run('ROLLBACK');
        } catch {
          // Silently ignore rollback errors
        }
        throw err;
      }
    },
  };
}
