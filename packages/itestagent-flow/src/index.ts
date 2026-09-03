export { compileFlow, inferRequiredCapabilities } from './compiler.js';
export { generateDraft, type DraftOptions, type DraftResult } from './draft-generator.js';
export {
  FLOW_SCHEMA_VERSION,
  parseFlowV2,
  safeParseFlowV2,
  type FlowStepV2,
  type FlowV2,
  type LocatorV2,
  type ValidatedTarget,
  FlowStepV2Schema,
  FlowV2Schema,
  LocatorV2Schema,
  ValidatedTargetSchema,
} from './schema.js';
export {
  readFlowFile,
  resolveFlowFile,
  saveFlow,
  type FlowFileSource,
  type ReadFlowOptions,
  type ReadFlowResult,
  type SaveFlowOptions,
  type SaveFlowResult,
} from './writer.js';
export { parseFlowYaml, serializeFlowYaml } from './yaml.js';
export {
  type ReplayOptions,
  type TargetCompatibilityResult,
  checkTargetCompatibility,
  replayFlow,
} from './replay.js';
export {
  type ReplayResult,
  type ReplayStepResult,
  type ReplayStepStatus,
  type ReplayEvidenceOutcome,
  type ReplayEvidenceStatus,
  type ReplaySummary,
  type ReplayEvidence,
  blockedStep,
  correlateReplayStep,
  createEmptySummary,
  failedStep,
  passedStep,
  skippedStep,
} from './replay-result.js';

// B08 module split: step dispatcher, UI-tree redaction, evidence writer.
export { executeStep } from './replay-step.js';
export { redactUiTreeXml, type UiTreeRedactionResult } from './ui-tree-redactor.js';
export {
  EVIDENCE_MANIFEST_FILENAME,
  collectStepEvidence,
  collectStepEvidenceResult,
  persistRawUiTree,
  validateRawArtifact,
  writeEvidenceManifest,
  type EvidenceCollectionResult,
  type EvidenceCorrelation,
  type EvidenceManifestWriteResult,
} from './replay-evidence-writer.js';
