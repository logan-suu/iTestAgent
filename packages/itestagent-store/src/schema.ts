import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Projects table — stores analyzed iOS project records.
 *
 * AC4: project 以 project_hash 标识，可追踪。
 */
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectHash: text('project_hash').notNull().unique(),
  workspacePath: text('workspace_path').notNull(),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

/**
 * Runs table — stores test execution records.
 *
 * AC4: run 以 run_id 标识，可追踪、复现、审计。
 * target_kind: physical | simulator (ADR-011)
 * CHECK constraint validated at app layer (Phase 1).
 */
export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().unique(),
  projectHash: text('project_hash')
    .notNull()
    .references(() => projects.projectHash),
  targetKind: text('target_kind').notNull(),
  status: text('status').notNull().default('created'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
