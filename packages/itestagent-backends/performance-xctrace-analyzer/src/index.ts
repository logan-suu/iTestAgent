/**
 * itestagent-backends-performance-xctrace-analyzer
 *
 * PerformanceBackend implementation using xcrun xctrace.
 * MVP first candidate per ADR-007 (T0.3 cross-evaluation).
 */

// Main factory
export {
  createXctracePerformanceBackend,
  healthcheckXctrace,
  XCTRACE_BACKEND_NAME,
} from './xctrace-performance-backend.js';
export type { XctracePerformanceBackendDeps } from './xctrace-performance-backend.js';

// CLI wrapper
export {
  checkXctraceAvailable,
  startRecording,
  exportTraceFile,
  listTraceSchemas,
  symbolicateCrash,
} from './xctrace-cli.js';
export type {
  XctraceCliDeps,
  SpawnSyncFn,
  SubprocessSpawnFn,
  SyncSpawnResult,
  RecordTraceInput,
  ExportTraceInput,
  ExportTraceResult,
  RecordHandle,
} from './xctrace-cli.js';

// Metrics parser
export {
  parsePerformanceMetrics,
  parseTraceSummary,
  parseRawMetrics,
} from './metrics-parser.js';
export type {
  ParsedMetrics,
  MetricsParserConfig,
} from './metrics-parser.js';

// Re-export contracts for convenience
export type {
  PerformanceBackend,
  ArtifactRef,
  TraceRecordInput,
  TraceExportInput,
  TraceExportStatus,
  TraceSummaryInput,
  TraceSummary,
  SymbolicateInput,
  BaselineCompareInput,
  BaselineDelta,
} from 'itestagent-contracts';

// ─── B21 module split: xml helpers, sysmon/export/leaks parsers, recorder ──
export {
  extractAttribute,
  findOpeningTags,
} from './xctrace-xml.js';
export { parseSysmonFrames, sumSampleCounts } from './xctrace-sysmon-parser.js';
export type { SysmonFrame } from './xctrace-sysmon-parser.js';
export { extractNodesByTag } from './xctrace-export.js';
export type { XctraceExportNode } from './xctrace-export.js';
export { parseLeaksReport } from './xctrace-leaks-parser.js';
export type { LeaksSummary } from './xctrace-leaks-parser.js';
export { createXctraceRecorder } from './xctrace-recorder.js';
export type {
  XctraceProcessRunner,
  XctraceRecordOptions,
  XctraceRecordTemplate,
  XctraceRecorderDeps,
} from './xctrace-recorder.js';
