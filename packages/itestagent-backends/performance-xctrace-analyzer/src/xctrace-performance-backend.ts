/**
 * XctracePerformanceBackend — PerformanceBackend implementation using xcrun xctrace.
 *
 * B21 module split: the recording wrapper lives in xctrace-recorder.
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
 *   baselineStore — optional BaselineStore for real compareBaseline (task 4.6)
 */

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

import type {
  ArtifactRef,
  BaselineCompareInput,
  BaselineDelta,
  BaselineStore,
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
  exportXctraceSelective,
  extractXcodeVersion,
  startRecording,
  symbolicateCrash,
} from './xctrace-cli.js';
import type {
  RecordHandle,
  SpawnSyncFn,
  SubprocessSpawnFn,
  XctraceCliDeps,
} from './xctrace-cli.js';

import { parseTraceSummary } from './metrics-parser.js';
import type { MetricsParserConfig } from './metrics-parser.js';

import { parseBaselineKey } from 'itestagent-contracts';
import { BaselineManager } from 'itestagent-engine';

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
  /** Optional BaselineStore for real compareBaseline (task 4.6). Omitting it falls back to inconclusive. */
  baselineStore?: BaselineStore;
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

/** Default subprocess spawn that wraps Bun.spawn to match SubprocessSpawnFn signature. */
function createDefaultSubprocessSpawn(): SubprocessSpawnFn {
  return (command, args, options) => {
    const subprocess = Bun.spawn([command, ...(args ?? [])], {
      cwd: options?.cwd ?? process.cwd(),
      env: options?.env as Record<string, string> | undefined,
      stdin: null,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    let killed = false;

    return {
      get pid() {
        return subprocess.pid;
      },
      exited: subprocess.exited.then((exitCode) => ({
        exitCode: exitCode === null || exitCode >= 128 ? null : exitCode,
        signal: exitCode !== null && exitCode >= 128 ? String(exitCode - 128) : undefined,
      })),
      kill(signal?: string) {
        if (killed || subprocess.killed) return;
        killed = true;
        subprocess.kill(signal as number | undefined);
      },
      isAlive() {
        return !subprocess.killed && !killed;
      },
    };
  };
}

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
  const subprocessSpawn = deps?.subprocessSpawn ?? createDefaultSubprocessSpawn();
  const workDir = deps?.workDir ?? tmpdir();
  const isSimulator = deps?.isSimulator ?? false;

  const cliDeps: XctraceCliDeps = {
    spawnSync,
    subprocessSpawn,
    workDir,
  };

  const baselineStore = deps?.baselineStore;
  const baselineManager = baselineStore ? new BaselineManager({ baselineStore }) : null;

  const recordingHandles = new Map<string, RecordHandle>();

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
        template: input.template ?? 'cpu',
        outputPath: tracePath,
        timeLimitSeconds: input.durationSeconds,
      });

      recordingHandles.set(traceId, recording);

      // Clean up handle when subprocess exits
      recording.subprocess.exited.then(
        () => {
          recordingHandles.delete(traceId);
        },
        () => {
          recordingHandles.delete(traceId);
        },
      );

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
     * Uses TOC-driven selective XPath export (Task 4.4):
     *   1. List TOC → parse available schemas
     *   2. Find exportable metrics via findMetricsInToc
     *   3. For each exportable metric, export via `xctrace export --xpath`
     *   4. Mark missing schemas as not_exportable per R5
     *
     * Trap Handbook §6: Simulator xctrace behavior differs from physical
     * (some schemas unavailable). Graceful fallback, no crash.
     *
     * AC4 (US-12.1): uses xcrun xctrace export for data extraction.
     */
    async exportTrace(input: TraceExportInput): Promise<TraceExportStatus> {
      const format = input.format ?? 'xml';
      const result = exportXctraceSelective(cliDeps, input.tracePath, format);

      if (!result.success && Object.keys(result.exported).length === 0) {
        return {
          status: 'failed',
          error: result.warnings.join('; ') || 'Failed to export trace',
        };
      }

      // Write each exported schema to individual files
      const exportedFiles: string[] = [];
      const exportId = randomUUID();

      for (const [schemaName, data] of Object.entries(result.exported)) {
        const ext = format === 'json' ? 'json' : 'xml';
        const safeSchemaName = schemaName.replace(/[^A-Za-z0-9_-]/g, '_');
        const exportPath = pathJoin(
          workDir,
          `itestagent-export-${exportId}-${safeSchemaName}.${ext}`,
        );

        try {
          await Bun.write(exportPath, data);
          exportedFiles.push(exportPath);
        } catch (err) {
          result.warnings.push(
            `Failed to write ${schemaName} export: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        }
      }

      return {
        status: exportedFiles.length > 0 ? 'completed' : 'failed',
        exportedFiles: exportedFiles.length > 0 ? exportedFiles : undefined,
        error:
          exportedFiles.length === 0
            ? result.warnings.join('; ') || 'No schemas exported'
            : undefined,
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
     * Delegates to BaselineManager for real delta computation when
     * a BaselineStore is available. Falls back to inconclusive when
     * no store is injected (backward compatible with task 4.3 tests).
     *
     * ADR-011: baseline domain isolation — simulator and physical baselines
     * are never compared across domains (enforced at BaselineStore layer).
     */
    async compareBaseline(input: BaselineCompareInput): Promise<BaselineDelta> {
      const current = input.current;
      const runId = randomUUID();
      const comparedAt = new Date().toISOString();

      // If no BaselineStore is wired, return placeholder as before (task 4.3 compat)
      if (!baselineManager) {
        const deltas: BaselineDelta['deltas'] = {};

        if (current.launchDurationMs !== undefined) deltas.launchDurationMs = 0;
        if (current.memoryPeakMB !== undefined) deltas.memoryPeakMB = 0;
        if (current.hangCount !== undefined) deltas.hangCount = 0;
        if (current.hitchesSummary) deltas.hitches = 'unchanged';
        if (current.fpsApproximate !== undefined) deltas.fpsApproximate = 0;

        return {
          baselineId: input.baselineId,
          runId,
          comparedAt,
          targetKind: input.targetKind,
          deltas,
          summary: 'inconclusive',
        };
      }

      const parsedKey = parseBaselineKey(input.baselineId);
      if (!parsedKey) {
        return {
          baselineId: input.baselineId,
          runId,
          comparedAt,
          targetKind: input.targetKind,
          deltas: {},
          summary: 'inconclusive',
        };
      }

      return baselineManager.compareWithBaseline(current, {
        runId,
        projectId: parsedKey.projectId,
        targetKind: parsedKey.targetKind,
        deviceModel: parsedKey.deviceModel,
        iosVersion: parsedKey.iosVersion,
        scenario: parsedKey.scenario,
      });
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
