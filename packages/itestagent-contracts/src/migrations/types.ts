/** B37: persisted schema migration types (§9 Stage 2A, §10). */
export interface MigrationIssue {
  code: string;
  message: string;
}
export type MigrationResult<T> = { ok: true; value: T } | { ok: false; issues: MigrationIssue[] };
