import { sql } from 'drizzle-orm';
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
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
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
  projectHash: text('project_hash').references(() => projects.projectHash),
  targetKind: text('target_kind').notNull(),
  backend: text('backend'),
  status: text('status').notNull().default('created'),
  parentRunId: text('parent_run_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const runSteps = sqliteTable('run_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id')
    .notNull()
    .references(() => runs.runId),
  stepId: text('step_id').notNull(),
  sequence: integer('sequence').notNull(),
  caseId: text('case_id'),
  status: text('status').notNull(),
  action: text('action').notNull(),
});

export const runCases = sqliteTable('run_cases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id')
    .notNull()
    .references(() => runs.runId),
  caseId: text('case_id').notNull(),
  status: text('status').notNull(),
});

export const runArtifacts = sqliteTable('run_artifacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id')
    .notNull()
    .references(() => runs.runId),
  artifactId: text('artifact_id').notNull(),
  type: text('type').notNull(),
  path: text('path').notNull(),
  relatedStep: text('related_step'),
  relatedCase: text('related_case'),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunStepRow = typeof runSteps.$inferSelect;
export type RunCaseRow = typeof runCases.$inferSelect;
export type RunArtifactRow = typeof runArtifacts.$inferSelect;
