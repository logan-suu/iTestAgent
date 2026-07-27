export { EvidenceCollector } from './evidence-collector.js';
export { symbolicateCrashlog } from './crashlog-symbolicator.js';
export { spawnAsync } from './spawn-async.js';
export {
  simctlScreenshot,
  simctlStartRecording,
  simctlCollectSyslog,
  simctlCollectCrashLogs,
} from './simctl-evidence.js';
export type { SimctlRecordingHandle } from './simctl-evidence.js';
export type {
  EvidenceType,
  EvidenceOptions,
  EvidenceResult,
  EvidenceCollectorConfig,
  EvidenceCollectionSummary,
} from './types.js';
export type { SymbolicationResult } from './crashlog-symbolicator.js';
