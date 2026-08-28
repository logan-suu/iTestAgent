export { ReportSynthesizer } from './synthesizer.js';
export { generateSummary } from './summary-generator.js';
export type { ArtifactEntry, ReportSynthesizerInput } from './types.js';

// ─── B09 module split: sanitizer, validator, replay adapter ──
export { REPORT_REDACTION_RULES, sanitizeReportText } from './report-sanitizer.js';
export type { ReportRedactionRule, ReportSanitizeResult } from './report-sanitizer.js';
export { findDanglingArtifactRefs, findDuplicateArtifactIds } from './report-validator.js';
export type { ReportValidationIssue, ReportValidationIssueCode } from './report-validator.js';
export { adaptReplayForReport } from './replay-to-report-adapter.js';
export type {
  ReplayReportInput,
  ReplayReportStep,
  ReplayToReportResult,
} from './replay-to-report-adapter.js';
