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

import { findMetricsInToc, generateExportXPaths, parseTocOutput } from './xctrace-toc-parser.js';
import type { ExportPlan, TocTable } from './xctrace-toc-parser.js';
import { detectXcodeVersion } from './xctrace-version-compat.js';
import type { XcodeVersion } from './xctrace-version-compat.js';

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

// ─── Task 4.4: Enhanced TOC / XPath / Version-aware functions ──────

/**
 * Extract Xcode version from the xctrace CLI.
 *
 * Runs `xcrun xctrace --version` and parses the version string.
 *
 * @param spawnSync - Spawn function
 * @returns Parsed XcodeVersion or null if unavailable
 */
export function extractXcodeVersion(spawnSync: SpawnSyncFn): XcodeVersion | null {
  const result = spawnSync('xcrun', ['xctrace', '--version']);
  if (result.exitCode !== 0) return null;
  return detectXcodeVersion(result.stdout);
}

/**
 * List available schemas in a trace file via --toc, returning parsed TocTable[].
 *
 * 避坑手册 §6: 底层用 xctrace export --toc 探测 + --xpath 抽取，schema 名称/列做容错。
 *
 * @param deps - CLI dependencies
 * @param tracePath - Path to the .trace directory
 * @returns Parsed TOC result with tables or error
 */
export function listTraceSchemasParsed(
  deps: XctraceCliDeps,
  tracePath: string,
): {
  success: boolean;
  tables: TocTable[];
  warnings: string[];
  error?: string;
} {
  const result = listTraceSchemas(deps, tracePath);
  if (!result.success) {
    return { success: false, tables: [], warnings: [], error: result.error };
  }

  const parsed = parseTocOutput(result.data);
  return { success: true, tables: parsed.tables, warnings: parsed.warnings };
}

/**
 * Result from selective trace export across multiple schemas.
 */
export interface SelectiveExportResult {
  /** Overall success (partial export is still success if some schemas exported). */
  success: boolean;
  /** Map of schema name → exported XML/JSON data. */
  exported: Record<string, string>;
  /** Metrics that could not be exported with reasons. */
  notExportable: Array<{ metric: string; reason: string }>;
  /** Any warnings during export. */
  warnings: string[];
}

/**
 * Selectively export a trace file using TOC-guided XPath expressions.
 *
 * 避坑手册 §6:
 *   - 底层用 xctrace export --xpath 抽取，schema 名称/列做容错
 *   - 不可导出显式标 not_exportable
 *   - 未知 schema 走容错分支不崩溃
 *
 * Flow:
 *   1. List TOC → parse into TocTable[]
 *   2. Find exportable metrics via findMetricsInToc
 *   3. For each exportable metric, run `xctrace export --xpath <xpath>`
 *   4. Collect results; mark missing schemas as not_exportable
 *
 * @param deps - CLI dependencies
 * @param tracePath - Path to the .trace directory
 * @param format - Export format (xml/json, default xml)
 * @returns SelectiveExportResult with per-schema data and not_exportable annotations
 */
export function exportXctraceSelective(
  deps: XctraceCliDeps,
  tracePath: string,
  format: 'xml' | 'json' = 'xml',
): SelectiveExportResult {
  // Step 1: List and parse TOC
  const tocResult = listTraceSchemasParsed(deps, tracePath);
  if (!tocResult.success) {
    return {
      success: false,
      exported: {},
      notExportable: [],
      warnings: [tocResult.error ?? 'Failed to list trace schemas'],
    };
  }

  // Step 2: Determine which metrics are exportable
  const plan = findMetricsInToc(tocResult.tables);

  // Step 3: Generate XPath expressions for exportable schemas
  const xpaths = generateExportXPaths(plan);

  // Step 4: Export each schema via XPath
  const exported: Record<string, string> = {};
  const exportWarnings: string[] = [];

  for (const xpath of xpaths) {
    const result = exportTraceFile(deps, {
      tracePath,
      xpath,
      format,
    });

    if (result.success) {
      // Use the xpath as a stable key (schema name extracted from XPath)
      const schemaKey = extractSchemaFromXPath(xpath);
      exported[schemaKey] = result.data;
    } else {
      exportWarnings.push(`Failed to export xpath "${xpath}": ${result.error}`);
    }
  }

  // Step 5: Build not_exportable annotations
  const notExportable = plan.notExportable.map((m) => ({
    metric: m.metric,
    reason: m.reason ?? 'Schema not available in trace',
  }));

  // Also add exportable metrics whose export failed as not_exportable
  for (const warning of exportWarnings) {
    const xpathMatch = warning.match(/xpath "([^"]+)"/);
    if (xpathMatch) {
      const schema = extractSchemaFromXPath(xpathMatch[1] ?? '');
      // Find the metric that uses this schema
      const metric = plan.exportable.find((m) => m.tables?.some((t) => t.schemaName === schema));
      if (metric) {
        notExportable.push({
          metric: metric.metric,
          reason: `Export failed: ${warning}`,
        });
      }
    }
  }

  return {
    success:
      Object.keys(exported).length > 0 ||
      notExportable.every((n) => n.reason.startsWith('No schema')),
    exported,
    notExportable,
    warnings: [...tocResult.warnings, ...exportWarnings],
  };
}

/**
 * Extract the schema name from an xctrace XPath expression.
 *
 * XPath format: /trace-toc/run[@number="1"]/data/table[@schema="SchemaName"]
 *
 * @param xpath - The XPath expression
 * @returns Schema name extracted from the XPath
 */
function extractSchemaFromXPath(xpath: string): string {
  const match = xpath.match(/\[@schema="([^"]+)"\]/);
  return match?.[1] ?? xpath;
}
