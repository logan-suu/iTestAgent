/**
 * XctracePerformanceBackend — PerformanceBackend implementation using xcrun xctrace.
 *
 * Implements the 5-method PerformanceBackend contract (architecture §5.2):
 *   recordTrace / exportTrace / summarizeTrace / symbolicate / compareBaseline
 *
 * AGENTS.md R2: wraps xctrace CLI, does not re-implement.
 * AGENTS.md R5: all metrics marked approximate unless proven otherwise.
 * ADR-011: simulator performance data labeled representativeOfPhysicalDevice=false.
 *
 * Dependencies are injectable for testability:
 *   xctraceOps — CLI wrapper (xctrace-cli.ts)
 *   metricsParser — XML → PerformanceMetrics parser
 *   subprocessSpawn — SubprocessController.spawn
 */

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

import type {
  ArtifactRef,
  BaselineCompareInput,
  BaselineDelta,
  PerformanceBackend,
  SymbolicateInput,
  TraceExportInput,
  TraceExportStatus,
  TraceRecordInput,
  TraceSummary,
  TraceSummaryInput,
} from 'itestagent-contracts';

import {
  checkXctraceAvailable,
  exportTraceFile,
  listTraceSchemas,
  startRecording,
  symbolicateCrash,
} from './xctrace-cli.js';
import type { SpawnSyncFn, SubprocessSpawnFn, XctraceCliDeps } from './xctrace-cli.js';

import { parseTraceSummary } from './metrics-parser.js';
import type { MetricsParserConfig } from './metrics-parser.js';

// ─── Types ────────────────────────────────────────────────────────

/** Injectable dependencies for XctracePerformanceBackend. */
export interface XctracePerformanceBackendDeps {
  /** Synchronous spawn (for xctrace export/version checks). */
  spawnSync: SpawnSyncFn;
  /** Subprocess spawn (for xctrace record). */
  subprocessSpawn: SubprocessSpawnFn;
  /** Working directory for trace outputs. */
  workDir?: string;
  /** Whether the target is a simulator (affects R5 annotations). */
  isSimulator?: boolean;
}

/** Backend name constant. */
export const XCTRACE_BACKEND_NAME = 'xctrace-analyzer-core';

// ─── Default implementations ──────────────────────────────────────

/** Default synchronous spawn using Bun.spawnSync. */
const defaultSpawnSync: SpawnSyncFn = (cmd, args, cwd) => {
  const result = Bun.spawnSync([cmd, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
};

/**
 * Create an XctracePerformanceBackend instance.
 *
 * Follows the factory pattern from build-xcodebuild (ADR-005 pluggable backend).
 * All dependencies are injectable for testability.
 *
 * @param deps - Optional partial dependencies (defaults to Bun.spawnSync)
 * @returns PerformanceBackend implementation
 */
export function createXctracePerformanceBackend(
  deps?: Partial<XctracePerformanceBackendDeps>,
): PerformanceBackend {
  const spawnSync = deps?.spawnSync ?? defaultSpawnSync;
  const subprocessSpawn =
    deps?.subprocessSpawn ?? (defaultSpawnSync as unknown as SubprocessSpawnFn);
  const workDir = deps?.workDir ?? tmpdir();
  const isSimulator = deps?.isSimulator ?? false;

  const cliDeps: XctraceCliDeps = {
    spawnSync,
    subprocessSpawn,
    workDir,
  };

  const parserConfig: MetricsParserConfig = {
    isSimulator,
  };

  // ─── Backend implementation ─────────────────────────────────

  const backend: PerformanceBackend = {
    /**
     * Start a performance recording session.
     *
     * Spawns `xcrun xctrace record` as a managed subprocess.
     * Returns an ArtifactRef immediately; recording continues asynchronously.
     * The caller is responsible for stopping the recording (via the SubprocessHandle).
     *
     * AC4 (US-12.1): underlying layer uses xcrun xctrace for recording.
     */
    async recordTrace(input: TraceRecordInput): Promise<ArtifactRef> {
      const traceId = randomUUID();
      const tracePath = pathJoin(workDir, `itestagent-trace-${traceId}.trace`);

      const recording = startRecording(cliDeps, {
        deviceId: input.deviceId,
        bundleId: input.bundleId,
        template: input.template ?? 'all',
        outputPath: tracePath,
        timeLimitSeconds: input.durationSeconds,
      });

      // Recording is managed externally — we just return the artifact reference.
      // The subprocess handle is available via recording.subprocess for lifecycle management.
      void recording.subprocess.exited.catch(() => {
        // Subprocess exit is handled by caller via abort/timelimit.
      });

      return {
        id: traceId,
        type: 'trace',
        path: tracePath,
        mimeType: 'application/octet-stream',
        redactionStatus: 'raw-local-only',
      };
    },

    /**
     * Export a recorded trace to XML/JSON data.
     *
     * Lists available schemas via --toc, then exports the full trace.
     * The export is synchronous (xctrace export is fast for reasonable traces).
     *
     * AC4 (US-12.1): uses xcrun xctrace export for data extraction.
     */
    async exportTrace(input: TraceExportInput): Promise<TraceExportStatus> {
      // First check what schemas are available
      const tocResult = listTraceSchemas(cliDeps, input.tracePath);

      if (!tocResult.success) {
        return {
          status: 'failed',
          error: tocResult.error ?? 'Failed to list trace schemas',
        };
      }

      // Export the full trace
      const exportResult = exportTraceFile(cliDeps, {
        tracePath: input.tracePath,
        format: input.format ?? 'xml',
      });

      if (!exportResult.success) {
        return {
          status: 'failed',
          error: exportResult.error ?? 'Failed to export trace',
        };
      }

      // Write exported data to a timestamped file
      const exportId = randomUUID();
      const exportPath = pathJoin(
        workDir,
        `itestagent-export-${exportId}.${input.format ?? 'xml'}`,
      );

      try {
        Bun.write(exportPath, exportResult.data);
      } catch (err) {
        return {
          status: 'failed',
          error: err instanceof Error ? err.message : 'Failed to write export file',
        };
      }

      return {
        status: 'completed',
        exportedFiles: [exportPath],
      };
    },

    /**
     * Analyze exported trace data and produce a performance summary.
     *
     * Parses the exported XML to extract:
     *   - launchDurationMs
     *   - memoryPeakMB (approximate, sampled)
     *   - crashDetected
     *   - hangCount
     *   - hitchesSummary
     *
     * AC1 (US-12.1): covers launch time / memory peak / crash / hitches/hangs
     * AC5 (US-12.1): memory peak annotated as approximate
     * R5: all metrics marked approximate=true
     */
    async summarizeTrace(input: TraceSummaryInput): Promise<TraceSummary> {
      let xmlData: string;

      try {
        xmlData = await Bun.file(input.exportedPath).text();
      } catch {
        // If the exported file can't be read, return a minimal summary
        return {
          approximate: true,
        };
      }

      const summary = parseTraceSummary(xmlData, parserConfig);

      // R5 + ADR-011: annotate simulator data
      if (isSimulator) {
        // Simulator performance data cannot represent physical device behavior
        summary.approximate = true;
      }

      return summary;
    },

    /**
     * Symbolicate a crash log.
     *
     * Delegates to `xcrun symbolicatecrash`.
     * For more advanced symbolication, the crashlog-symbolicator in
     * itestagent-engine provides 3-strategy resolution (xcrun symbolicatecrash,
     * xcrun atos, llvm-symbolizer) but is engine-layer, not backend-layer.
     */
    async symbolicate(input: SymbolicateInput): Promise<ArtifactRef> {
      const result = symbolicateCrash(cliDeps, input.crashlogPath, input.dsymPath);

      if (!result.success) {
        // Return a reference to the original crash log if symbolication fails
        return {
          id: randomUUID(),
          type: 'crashlog',
          path: input.crashlogPath,
          mimeType: 'text/plain',
          redactionStatus: 'raw-local-only',
        };
      }

      // Write symbolicated output
      const symId = randomUUID();
      const symPath = pathJoin(workDir, `itestagent-symbolicated-${symId}.crash`);

      try {
        Bun.write(symPath, result.data);
      } catch (err) {
        return {
          id: symId,
          type: 'crashlog',
          path: input.crashlogPath,
          mimeType: 'text/plain',
          redactionStatus: 'raw-local-only',
        };
      }

      return {
        id: symId,
        type: 'crashlog',
        path: symPath,
        mimeType: 'text/plain',
        redactionStatus: 'raw-local-only',
      };
    },

    /**
     * Compare current metrics against a baseline.
     *
     * Computes simple delta values between current and baseline metrics.
     * Full baseline persistence (reading from store) is deferred to task 4.6.
     *
     * ADR-011: baseline domain isolation — simulator and physical baselines
     * are never compared across domains.
     */
    async compareBaseline(input: BaselineCompareInput): Promise<BaselineDelta> {
      const current = input.current;
      const deltas: BaselineDelta['deltas'] = {};

      if (current.launchDurationMs !== undefined) {
        deltas.launchDurationMs = 0; // No baseline to compare against (deferred to 4.6)
      }

      if (current.memoryPeakMB !== undefined) {
        deltas.memoryPeakMB = 0; // No baseline to compare against
      }

      if (current.hangCount !== undefined) {
        deltas.hangCount = 0;
      }

      if (current.hitchesSummary) {
        deltas.hitches = 'unchanged';
      }

      return {
        baselineId: input.baselineId,
        runId: randomUUID(),
        comparedAt: new Date().toISOString(),
        targetKind: input.targetKind,
        deltas,
        summary: 'inconclusive', // No historical baseline available yet (task 4.6)
      };
    },
  };

  return backend;
}

/**
 * Quick health check — verify xctrace is available and responsive.
 *
 * @param deps - Optional spawn dependencies
 * @returns Health check result
 */
export function healthcheckXctrace(deps?: Partial<XctracePerformanceBackendDeps>): {
  available: boolean;
  version?: string;
  error?: string;
} {
  const spawnSync = deps?.spawnSync ?? defaultSpawnSync;
  return checkXctraceAvailable(spawnSync);
}
