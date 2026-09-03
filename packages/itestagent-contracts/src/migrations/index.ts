/** B37: persisted schema migrations barrel (§9 Stage 2A). */
export { migrateConfigV1 } from './config-v1.js';
export { migrateResultV1 } from './result-v1.js';
export { migrateArtifactIndexV1 } from './artifact-index-v1.js';
export { migrateTestPlanV1, migrateTestPlanV2, migrateTestPlanToV3 } from './test-plan-v2.js';
export { readPersistedRunResult, readPersistedArtifactIndex } from './run-bundle-v3.js';
export type { MigrationIssue, MigrationResult, CompatibilityReadResult } from './types.js';
