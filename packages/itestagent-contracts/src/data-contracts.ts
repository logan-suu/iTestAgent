/**
 * iTestAgent Core Data Contracts（Zod）
 *
 * 架构设计文档 §6.3-§6.6 + 数据流全链路 S6-S9：
 *   定义 RunStep、RunResult、ArtifactIndex 及配套的嵌套 schema，
 *   所有产物均带 schemaVersion，面向 schema 编码。
 *
 * AGENTS.md §5 数据契约：
 *   产物必须带 schemaVersion；report 固定三件套 summary.md + result.json + artifact-index.json。
 *
 * B03 (promotion migration, guide §11.4 "result+artifact-index→B03"): the
 * RunResult-side and ArtifactIndex-side schemas were split into focused
 * modules — run-result-contracts.ts / artifact-index-contract.ts — and the
 * cross-field rules that Zod object schemas cannot express moved to
 * json-schema-cross-field.ts. This file re-exports them so existing
 * importers of './data-contracts.js' keep working.
 */

export {
  DEFAULT_SCHEMA_VERSION,
  RUN_RESULT_SCHEMA_VERSION,
  RunStatusSchema,
  CaseStatusSchema,
  PerformanceMetricsSchema,
  ExecutionSummarySchema,
  TestCaseResultSchema,
  FailureExplanationSchema,
  RunStepSchema,
  RunResultSchema,
  migrateV1ToV2,
  parseRunResult,
} from './run-result-contracts.js';

export type {
  RunStatus,
  CaseStatus,
  PerformanceMetrics,
  ExecutionSummary,
  TestCaseResult,
  FailureExplanation,
  RunStep,
  RunResult,
  MigratedRunResultV2,
} from './run-result-contracts.js';

export {
  ARTIFACT_INDEX_SCHEMA_VERSION,
  ArtifactIndexSchema,
  EvidenceCollectionStatusSchema,
  EvidenceCollectionOutcomeSchema,
  parseArtifactIndex,
} from './artifact-index-contract.js';

export type {
  ArtifactIndex,
  EvidenceCollectionStatus,
  EvidenceCollectionOutcome,
} from './artifact-index-contract.js';

export {
  RUN_STEPS_SCHEMA_VERSION,
  RunStepsDocumentSchema,
  parseRunStepsDocument,
} from './run-steps-contract.js';

export type { RunStepsDocument } from './run-steps-contract.js';
