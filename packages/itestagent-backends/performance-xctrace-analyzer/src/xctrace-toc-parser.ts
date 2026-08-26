/**
 * xctrace-toc-parser — parses xcrun xctrace export --toc output.
 *
 * B21 module split: shared XML helpers live in xctrace-xml; export-node
 * extraction in xctrace-export.
 *
 * AGENTS.md R5: metrics not exportable are explicitly marked not_exportable;
 * unknown schemas are not crash-causing.
 *
 * Trap Handbook §6:
 *   - Use xctrace export --toc for discovery + --xpath for extraction, schema name/column tolerance
 *   - Non-exportable explicitly marked not_exportable; memory marked approximate; never fabricate
 *   - Simulator xctrace behavior differs from physical (some schemas unavailable)
 *   - Unknown schemas use graceful fallback, no crash
 */

// ─── Types ────────────────────────────────────────────────────────

/** A single table entry from the xctrace --toc output. */
export interface TocTable {
  /** Schema name (e.g. "Hitch", "kdebug", "os-signpost") */
  schemaName: string;
  /** Table name within the schema (e.g. "Hitch", "os-signpost-intervals") */
  tableName: string;
  /** Column names listed in the TOC (may be empty for header-only entries) */
  columns: string[];
}

/** Result of parsing TOC output. */
export interface TocResult {
  /** All parsed tables from the TOC. */
  tables: TocTable[];
  /** Raw parse errors (non-fatal: partial parse still returns tables) */
  warnings: string[];
}

/** A metric that may or may not be exportable from a trace. */
export interface MetricAvailability {
  /** Metric identifier (e.g. "hitches", "memory", "launch", "hangs", "crash") */
  metric: string;
  /** Whether the metric has matching schema in the TOC */
  available: boolean;
  /** Matching TocTable(s) if available */
  tables?: TocTable[];
  /** Reason why unavailable (for not_exportable annotations) */
  reason?: string;
}

/** Result of checking which metrics are exportable from a TOC. */
export interface ExportPlan {
  /** Metrics that can be exported (schema found in TOC). */
  exportable: MetricAvailability[];
  /** Metrics that cannot be exported (schema missing from TOC). */
  notExportable: MetricAvailability[];
}

/** Known metric-to-schema mappings for xctrace. */
export interface MetricSchemaMapping {
  /** Human-readable metric name */
  metric: string;
  /** Schema name patterns to search for (case-insensitive substring match) */
  schemaPatterns: string[];
  /** Required column name patterns (at least one must match for the schema to be considered usable) */
  requiredColumnPatterns?: string[];
}

// ─── Constants ────────────────────────────────────────────────────

/**
 * Standard metric-to-schema mappings.
 *
 * These patterns are matched case-insensitively against schema/table names
 * found in the TOC. If a matching schema has at least one matching column
 * (when requiredColumnPatterns is specified), the metric is exportable.
 *
 * Trap Handbook §6: xctrace export XML schema changes across Xcode versions;
 * pattern matching used instead of exact names for tolerance.
 */
export const METRIC_SCHEMA_MAP: MetricSchemaMapping[] = [
  {
    metric: 'hitches',
    schemaPatterns: ['hitch'],
    requiredColumnPatterns: ['hitch_ratio', 'hitch_time'],
  },
  {
    metric: 'memory',
    schemaPatterns: ['allocation', 'vm', 'memory'],
    requiredColumnPatterns: ['size', 'bytes', 'count'],
  },
  {
    metric: 'launch',
    schemaPatterns: ['launch', 'app_launch', 'app-launch'],
  },
  {
    metric: 'hangs',
    schemaPatterns: ['hang', 'main_thread'],
  },
  {
    metric: 'crash',
    schemaPatterns: ['crash', 'exception', 'signal'],
  },
  {
    metric: 'cpu',
    schemaPatterns: ['time_profile', 'cpu', 'thread'],
  },
];

// ─── TOC Parsing ─────────────────────────────────────────────────

/**
 * Parse the raw text output of `xcrun xctrace export --toc` into structured TocTable[].
 *
 * Expected format (example):
 * ```
 * Schema Name                              | Table Name
 * -----------------------------------------
 * Hitch                                    |
 *   Hitch                                  | hitch_time_mach_absolute_time, hitch_ratio, ...
 * os-signpost                              |
 *   os-signpost-intervals                  | annotation, category, duration_ms, ...
 * kdebug                                   |
 * ```
 *
 * Trap Handbook §6: Unknown schemas use graceful fallback, no crash.
 * Partial parse is returned even when some lines are unrecognized.
 *
 * @param raw - Raw text output from `xctrace export --toc`
 * @returns TocResult with parsed tables and any non-fatal warnings
 */
export function parseTocOutput(raw: string): TocResult {
  const tables: TocTable[] = [];
  const warnings: string[] = [];
  const lines = raw.split('\n');

  let currentSchema: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (line === undefined) continue;

    if (line.length === 0) continue;

    // Skip the header line
    if (line.includes('Schema Name') && line.includes('Table Name')) {
      continue;
    }

    // Skip separator line
    if (/^-{10,}/.test(line)) {
      continue;
    }

    // Schema header with trailing pipe (no columns after pipe):
    // e.g. "kdebug                                   |"
    // e.g. "App Launch                               |"
    const trailingPipeMatch = line.match(/^([A-Za-z][A-Za-z0-9_. -]+)\s+\|$/);
    if (trailingPipeMatch?.[1]) {
      currentSchema = trailingPipeMatch[1].trim() || null;
      continue;
    }

    // Try to parse as a table line: "TableName | col1, col2, col3"
    const pipeMatch = line.match(/^(.+?)\s*\|\s*(.+)$/);
    if (pipeMatch) {
      const tableName = pipeMatch[1]?.trim() ?? 'unknown';
      const columnsRaw = pipeMatch[2]?.trim() ?? '';
      const columns = columnsRaw
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      // If we have a current schema, use it; otherwise use tableName as schema
      const schemaName = currentSchema ?? tableName;

      tables.push({
        schemaName,
        tableName,
        columns,
      });
      continue;
    }

    // Schema header: just a name (no pipe at all)
    // xctrace schema names are brief: 1-3 words max, no commas/multiple pipes
    if (/^[A-Za-z][A-Za-z0-9_. -]{0,40}$/.test(line) && line.split(/\s+/).length <= 3) {
      currentSchema = line;
      continue;
    }

    // Unrecognized line: record warning, don't crash
    if (line.length > 0) {
      warnings.push(`Unrecognized TOC line at index ${i}: "${line.substring(0, 80)}"`);
    }
  }

  return { tables, warnings };
}

// ─── Metric Availability ──────────────────────────────────────────

/**
 * Check which standard metrics are exportable from a trace.
 *
 * Matches each metric's schema patterns against the parsed TOC tables
 * (case-insensitive). If requiredColumnPatterns is specified, at least one
 * matching column must exist in the table.
 *
 * Trap Handbook §6: Simulator xctrace behavior differs from physical
 * (some schemas unavailable).
 * Missing schemas are classified as notExportable with a reason.
 *
 * @param tables - Parsed TOC tables
 * @param desiredMetrics - Which metrics to check (defaults to all METRIC_SCHEMA_MAP)
 * @returns ExportPlan with exportable/notExportable classification
 */
export function findMetricsInToc(
  tables: TocTable[],
  desiredMetrics: string[] = METRIC_SCHEMA_MAP.map((m) => m.metric),
): ExportPlan {
  const exportable: MetricAvailability[] = [];
  const notExportable: MetricAvailability[] = [];

  for (const metricName of desiredMetrics) {
    const mapping = METRIC_SCHEMA_MAP.find((m) => m.metric === metricName);
    if (!mapping) {
      notExportable.push({
        metric: metricName,
        available: false,
        reason: `Unknown metric "${metricName}" — not in METRIC_SCHEMA_MAP`,
      });
      continue;
    }

    // Find tables that match any of the schema patterns
    const matchedTables = tables.filter((t) =>
      mapping.schemaPatterns.some(
        (pattern) =>
          t.schemaName.toLowerCase().includes(pattern.toLowerCase()) ||
          t.tableName.toLowerCase().includes(pattern.toLowerCase()),
      ),
    );

    if (matchedTables.length === 0) {
      notExportable.push({
        metric: metricName,
        available: false,
        reason: `No schema matching patterns [${mapping.schemaPatterns.join(', ')}] found in TOC`,
      });
      continue;
    }

    // If required columns are specified, check at least one table has them
    if (mapping.requiredColumnPatterns && mapping.requiredColumnPatterns.length > 0) {
      const hasRequiredColumns = matchedTables.some((t) =>
        mapping.requiredColumnPatterns?.some((colPattern) =>
          t.columns.some((c) => c.toLowerCase().includes(colPattern.toLowerCase())),
        ),
      );

      if (!hasRequiredColumns) {
        notExportable.push({
          metric: metricName,
          available: false,
          reason: `Schema found but missing required columns: [${mapping.requiredColumnPatterns.join(', ')}]`,
        });
        continue;
      }
    }

    exportable.push({
      metric: metricName,
      available: true,
      tables: matchedTables,
    });
  }

  return { exportable, notExportable };
}

/**
 * Generate an XPath expression to extract a specific schema from xctrace export.
 *
 * Uses the trace-format xpath: /trace-toc/run[@number="1"]/data/table[@schema="..."]
 *
 * @param schemaName - The schema name to target
 * @returns XPath string for use with `xctrace export --xpath`
 */
export function schemaToXPath(schemaName: string): string {
  return `/trace-toc/run[@number="1"]/data/table[@schema="${schemaName}"]`;
}

/**
 * Generate XPath expressions for all exportable metrics in an ExportPlan.
 *
 * @param plan - The export plan from findMetricsInToc
 * @returns Array of XPath strings, one per exportable metric
 */
export function generateExportXPaths(plan: ExportPlan): string[] {
  const xpaths: string[] = [];

  for (const metric of plan.exportable) {
    if (metric.tables && metric.tables.length > 0) {
      for (const table of metric.tables) {
        xpaths.push(schemaToXPath(table.schemaName));
      }
    }
  }

  // Deduplicate
  return [...new Set(xpaths)];
}
