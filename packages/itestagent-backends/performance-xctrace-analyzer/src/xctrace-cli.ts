/**
 * xctrace-cli — thin wrapper around xcrun xctrace commands.
 *
 * AGENTS.md R2: wraps Apple official xctrace CLI, does not re-implement.
 * AGENTS.md R5: metrics from xctrace are marked approximate where uncertain.
 *
 * Uses SubprocessController for lifecycle management (ADR-010 abort chain).
 */

import type { spawn as scSpawn } from 'itestagent-server';
import type { SubprocessHandle } from 'itestagent-server';
import type { SignalName } from 'itestagent-server';

// ─── Types ────────────────────────────────────────────────────────

/** Result of a synchronous spawn call. */
export interface SyncSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Spawn function signature (synchronous). */
export type SpawnSyncFn = (cmd: string, args: string[], cwd?: string) => SyncSpawnResult;

/** Factory function for SubprocessController.spawn. */
export type SubprocessSpawnFn = typeof scSpawn;

/** Injectable dependencies for xctrace CLI operations. */
export interface XctraceCliDeps {
  /** Synchronous spawn (for quick checks like --version). */
  spawnSync: SpawnSyncFn;
  /** Subprocess spawn (for long-running xctrace record). */
  subprocessSpawn: SubprocessSpawnFn;
  /** Working directory for temp trace output. */
  workDir: string;
}

/** Input for recordTrace. */
export interface RecordTraceInput {
  /** Device UDID (physical or simulator). */
  deviceId: string;
  /** App bundle ID to attach. */
  bundleId: string;
  /** Recording template. */
  template: string;
  /** Output .trace file path. */
  outputPath: string;
  /** Optional time limit in seconds. */
  timeLimitSeconds?: number;
  /** AbortSignal for cancellation (ADR-010). */
  signal?: AbortSignal;
}

/** Input for exportTrace. */
export interface ExportTraceInput {
  /** Path to the .trace directory. */
  tracePath: string;
  /** XPath expression for selective export. */
  xpath?: string;
  /** Export format (xml/json). */
  format?: 'xml' | 'json';
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/** Result of a trace export. */
export interface ExportTraceResult {
  /** Whether the export succeeded. */
  success: boolean;
  /** Exported data as string (stdout). */
  data: string;
  /** Error message if failed. */
  error?: string;
}

/** Result of recording handle. */
export interface RecordHandle {
  /** Subprocess handle for lifecycle management. */
  subprocess: SubprocessHandle;
  /** Path to the output .trace file. */
  tracePath: string;
}

// ─── Template mapping ──────────────────────────────────────────────

/** Map template names to xctrace template identifiers. */
const TEMPLATE_MAP: Record<string, string> = {
  cpu: 'Time Profiler',
  hangs: 'Hangs',
  memory: 'Allocations',
  launch: 'App Launch',
  all: 'All',
};

/**
 * Resolve a short template name to its xctrace template identifier.
 */
function resolveTemplateName(template: string): string {
  return TEMPLATE_MAP[template] ?? 'Time Profiler';
}

// ─── Implementation ────────────────────────────────────────────────

/**
 * Verify that xctrace is available on the system.
 */
export function checkXctraceAvailable(spawnSync: SpawnSyncFn): {
  available: boolean;
  version?: string;
  error?: string;
} {
  const result = spawnSync('xcrun', ['xctrace', '--version']);
  if (result.exitCode !== 0) {
    return { available: false, error: result.stderr.trim() || 'xctrace not found' };
  }
  const version = result.stdout.trim().split('\n')[0] ?? undefined;
  return { available: true, version };
}

/**
 * Start an xctrace recording session.
 *
 * Returns a RecordHandle with the subprocess handle and trace output path.
 * The caller must manage the subprocess lifecycle (stop recording to complete the trace).
 *
 * Command: xcrun xctrace record --template "{template}" --output "{path}" --attach "{bundleId}" [--time-limit {secs}s]
 */
export function startRecording(deps: XctraceCliDeps, input: RecordTraceInput): RecordHandle {
  const templateId = resolveTemplateName(input.template);
  const args = [
    'xctrace',
    'record',
    '--template',
    templateId,
    '--output',
    input.outputPath,
    '--device',
    input.deviceId,
    '--attach',
    input.bundleId,
  ];

  if (input.timeLimitSeconds && input.timeLimitSeconds > 0) {
    args.push('--time-limit', `${input.timeLimitSeconds}s`);
  }

  const subprocess = deps.subprocessSpawn('xcrun', args, {
    cwd: deps.workDir,
    signal: input.signal,
    timeoutMs: input.timeLimitSeconds ? (input.timeLimitSeconds + 10) * 1000 : undefined,
  });

  return {
    subprocess,
    tracePath: input.outputPath,
  };
}

/**
 * Export a recorded trace to XML/JSON data.
 *
 * Lists available schemas via --toc, then exports the full trace as XML.
 *
 * Command: xcrun xctrace export --input "{tracePath}" [--xpath "{xpath}"]
 */
export function exportTraceFile(deps: XctraceCliDeps, input: ExportTraceInput): ExportTraceResult {
  const args = ['xctrace', 'export', '--input', input.tracePath];

  if (input.xpath) {
    args.push('--xpath', input.xpath);
  }

  const result = deps.spawnSync('xcrun', args, deps.workDir);

  if (result.exitCode !== 0) {
    return {
      success: false,
      data: '',
      error: result.stderr.trim() || `xctrace export failed with exit code ${result.exitCode}`,
    };
  }

  return {
    success: true,
    data: result.stdout,
  };
}

/**
 * List available schemas in a trace file via --toc.
 *
 * Command: xcrun xctrace export --input "{tracePath}" --toc
 */
export function listTraceSchemas(deps: XctraceCliDeps, tracePath: string): ExportTraceResult {
  const args = ['xctrace', 'export', '--input', tracePath, '--toc'];

  const result = deps.spawnSync('xcrun', args, deps.workDir);

  if (result.exitCode !== 0) {
    return {
      success: false,
      data: '',
      error:
        result.stderr.trim() || `xctrace export --toc failed with exit code ${result.exitCode}`,
    };
  }

  return {
    success: true,
    data: result.stdout,
  };
}

/**
 * Symbolicate a crashlog file.
 *
 * Command: xcrun symbolicatecrash "{crashPath}" [dsymPath]
 */
export function symbolicateCrash(
  deps: XctraceCliDeps,
  crashPath: string,
  dsymPath?: string,
): ExportTraceResult {
  const args = ['symbolicatecrash', crashPath];

  if (dsymPath) {
    args.push(dsymPath);
  }

  const result = deps.spawnSync('xcrun', args, deps.workDir);

  if (result.exitCode !== 0) {
    return {
      success: false,
      data: '',
      error: result.stderr.trim() || `symbolicatecrash failed with exit code ${result.exitCode}`,
    };
  }

  return {
    success: true,
    data: result.stdout,
  };
}
