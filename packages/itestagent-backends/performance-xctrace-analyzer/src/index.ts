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
