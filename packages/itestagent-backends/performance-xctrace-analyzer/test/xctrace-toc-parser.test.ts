/**
 * Tests for xctrace-toc-parser — TOC output parsing and metric availability.
 *
 * 避坑手册 §6: physical + simulator 双份 trace fixture。
 * 未知 schema 走容错分支不崩溃。
 */

import { describe, expect, it } from 'bun:test';
import {
  METRIC_SCHEMA_MAP,
  findMetricsInToc,
  generateExportXPaths,
  parseTocOutput,
  schemaToXPath,
} from '../src/xctrace-toc-parser.js';
import type { ExportPlan, TocTable } from '../src/xctrace-toc-parser.js';

// ─── Fixtures ──────────────────────────────────────────────────────

/** Realistic xctrace --toc output from physical device (Xcode 16, "All" template). */
const TOC_PHYSICAL_XCODE16 = `
Schema Name                              | Table Name
-----------------------------------------
Hitch                                    |
  Hitch                                  | hitch_time_mach_absolute_time, hitch_ratio, hitch_frame_number, hitch_duration_ms, hitch_display_refresh_rate
os-signpost                              |
  os-signpost-intervals                  | annotation, category, duration_ms, event_type, process, thread
kdebug                                   |
  kdebug-events                          | timestamp, event_id, debug_id, cpu_id, thread, process
VM                                       |
  VM-operations                          | operation_type, start_time, duration_us, address, size, thread, process
App Launch                               |
  App Launch                             | launch_type, duration_ms, process, thread
Hangs                                    |
  Hangs                                  | hang_duration_ms, process, thread_id
`;

/** Realistic xctrace --toc output from simulator (Xcode 16) where some schemas are unavailable. */
const TOC_SIMULATOR_XCODE16 = `
Schema Name                              | Table Name
-----------------------------------------
os-signpost                              |
  os-signpost-intervals                  | annotation, category, duration_ms, event_type, process, thread
kdebug                                   |
  kdebug-events                          | timestamp, event_id, debug_id, cpu_id, thread, process
App Launch                               |
  App Launch                             | launch_type, duration_ms, process, thread
`;

/**
 * Xcode 26 Deferred 录制模式 TOC — schema names may differ.
 * In Xcode 26, "Hitch" is renamed to "HitchData" and uses different column names.
 */
const TOC_XCODE26_DEFERRED = `
Schema Name                              | Table Name
-----------------------------------------
HitchData                                |
  HitchData                              | hitch_ratio_pct, hitch_time_ns, frame_idx, dur_us, refresh_rate_hz
os-signpost                              |
  os-signpost-intervals                  | annotation, category, duration_ms, event_type, process, thread
App Launch                               |
  App Launch                             | launch_type, duration_ms, process, thread
Hangs                                    |
  Hangs                                  | hang_duration_ms, process, thread_id
VM                                       |
  VM-operations                          | operation_type, start_time, duration_us, address, size, thread, process
`;

/** Empty TOC (edge case). */
const TOC_EMPTY = '';

/** Malformed TOC with garbage lines mixed in. */
const TOC_MALFORMED = `
Schema Name                              | Table Name
-----------------------------------------
Hitch                                    |
  Hitch                                  | hitch_ratio, hitch_duration
garbage line that makes no sense
os-signpost                              |
  INVALID|ENTRY|HERE
  os-signpost-intervals                  | annotation, category, duration_ms
another garbage line
`;

// ─── parseTocOutput ─────────────────────────────────────────────────

describe('parseTocOutput', () => {
  it('parses physical device TOC with multiple schemas', () => {
    const result = parseTocOutput(TOC_PHYSICAL_XCODE16);

    expect(result.tables.length).toBe(6);
    expect(result.warnings.length).toBe(0);

    // Hitch table
    const hitch = result.tables.find((t) => t.tableName === 'Hitch');
    expect(hitch).toBeDefined();
    expect(hitch?.schemaName).toBe('Hitch');
    expect(hitch?.columns).toContain('hitch_ratio');
    expect(hitch?.columns).toContain('hitch_duration_ms');

    // App Launch table
    const launch = result.tables.find((t) => t.tableName === 'App Launch');
    expect(launch).toBeDefined();
    expect(launch?.schemaName).toBe('App Launch');
    expect(launch?.columns).toContain('launch_type');
    expect(launch?.columns).toContain('duration_ms');

    // VM-operations
    const vm = result.tables.find((t) => t.tableName === 'VM-operations');
    expect(vm).toBeDefined();
    expect(vm?.schemaName).toBe('VM');
    expect(vm?.columns).toContain('size');
  });

  it('parses simulator TOC where Hitch and Hangs schemas are absent', () => {
    const result = parseTocOutput(TOC_SIMULATOR_XCODE16);

    expect(result.tables.length).toBe(3);
    expect(result.tables.some((t) => t.schemaName.includes('Hitch'))).toBe(false);
    expect(result.tables.some((t) => t.schemaName.includes('Hangs'))).toBe(false);
    expect(result.tables.some((t) => t.schemaName.includes('os-signpost'))).toBe(true);
  });

  it('parses Xcode 26 Deferred mode TOC with HitchData schema', () => {
    const result = parseTocOutput(TOC_XCODE26_DEFERRED);

    expect(result.tables.length).toBe(5);

    // HitchData uses different column names in Xcode 26
    const hitchData = result.tables.find((t) => t.tableName === 'HitchData');
    expect(hitchData).toBeDefined();
    expect(hitchData?.schemaName).toBe('HitchData');
    expect(hitchData?.columns).toContain('hitch_ratio_pct');
    expect(hitchData?.columns).toContain('hitch_time_ns');

    // App Launch still present
    const launch = result.tables.find((t) => t.tableName === 'App Launch');
    expect(launch).toBeDefined();
  });

  it('handles empty TOC output gracefully', () => {
    const result = parseTocOutput(TOC_EMPTY);

    expect(result.tables.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });

  it('handles malformed lines with warnings, still parses valid entries', () => {
    const result = parseTocOutput(TOC_MALFORMED);

    // Should still parse valid entries
    const hitch = result.tables.find((t) => t.tableName === 'Hitch');
    expect(hitch).toBeDefined();
    expect(hitch?.columns).toContain('hitch_ratio');

    const signpost = result.tables.find((t) => t.tableName === 'os-signpost-intervals');
    expect(signpost).toBeDefined();
    expect(signpost?.columns).toContain('annotation');

    // Should have warnings for unrecognized lines
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('garbage'))).toBe(true);
  });

  it('correctly infers schemaName from context when table is indented', () => {
    const result = parseTocOutput(TOC_PHYSICAL_XCODE16);

    // kdebug table under kdebug schema
    const kdebug = result.tables.find((t) => t.tableName === 'kdebug-events');
    expect(kdebug).toBeDefined();
    expect(kdebug?.schemaName).toBe('kdebug');

    // Hangs table under Hangs schema
    const hangs = result.tables.find((t) => t.tableName === 'Hangs');
    expect(hangs).toBeDefined();
    expect(hangs?.schemaName).toBe('Hangs');
  });
});

// ─── findMetricsInToc ──────────────────────────────────────────────

describe('findMetricsInToc', () => {
  it('finds all standard metrics in physical device TOC', () => {
    const { tables } = parseTocOutput(TOC_PHYSICAL_XCODE16);
    const plan = findMetricsInToc(tables);

    expect(plan.exportable.length).toBeGreaterThanOrEqual(4);
    expect(plan.notExportable.length).toBeLessThanOrEqual(2);

    const hitchesMetric = plan.exportable.find((m) => m.metric === 'hitches');
    expect(hitchesMetric).toBeDefined();
    expect(hitchesMetric?.available).toBe(true);
    expect(hitchesMetric?.tables?.length).toBe(1);
    expect(hitchesMetric?.tables?.[0]?.tableName).toBe('Hitch');

    const memoryMetric = plan.exportable.find((m) => m.metric === 'memory');
    expect(memoryMetric).toBeDefined();
    expect(memoryMetric?.available).toBe(true);
    expect(memoryMetric?.tables?.[0]?.tableName).toBe('VM-operations');

    const launchMetric = plan.exportable.find((m) => m.metric === 'launch');
    expect(launchMetric).toBeDefined();
    expect(launchMetric?.available).toBe(true);

    const hangsMetric = plan.exportable.find((m) => m.metric === 'hangs');
    expect(hangsMetric).toBeDefined();
    expect(hangsMetric?.available).toBe(true);
  });

  it('marks metrics as notExportable when schema missing (simulator)', () => {
    const { tables } = parseTocOutput(TOC_SIMULATOR_XCODE16);
    const plan = findMetricsInToc(tables);

    // Simulator: Hitch and Hangs schemas absent
    const hitches = plan.notExportable.find((m) => m.metric === 'hitches');
    expect(hitches).toBeDefined();
    expect(hitches?.available).toBe(false);
    expect(hitches?.reason).toContain('No schema matching');

    const hangs = plan.notExportable.find((m) => m.metric === 'hangs');
    expect(hangs).toBeDefined();
    expect(hangs?.available).toBe(false);

    // Launch should still be exportable (App Launch schema exists on simulator too)
    const launchMetric = plan.exportable.find((m) => m.metric === 'launch');
    expect(launchMetric).toBeDefined();
    expect(launchMetric?.available).toBe(true);
  });

  it('handles Xcode 26 HitchData schema via pattern matching', () => {
    const { tables } = parseTocOutput(TOC_XCODE26_DEFERRED);
    const plan = findMetricsInToc(tables);

    // HitchData matches the 'hitch' pattern
    const hitches = plan.exportable.find((m) => m.metric === 'hitches');
    expect(hitches).toBeDefined();
    expect(hitches?.tables?.[0]?.tableName).toBe('HitchData');
    expect(hitches?.tables?.[0]?.columns).toContain('hitch_ratio_pct');

    // Memory should still be available (VM-operations present)
    const memory = plan.exportable.find((m) => m.metric === 'memory');
    expect(memory).toBeDefined();
    expect(memory?.available).toBe(true);
  });

  it('marks metric as notExportable when schema exists but required columns missing', () => {
    // Create a TOC where Hitch exists but without the required hitch_ratio column
    const tocNoRequiredColumns = {
      tables: [{ schemaName: 'Hitch', tableName: 'Hitch', columns: ['timestamp', 'duration'] }],
      warnings: [],
    };

    const plan = findMetricsInToc(tocNoRequiredColumns.tables, ['hitches']);

    expect(plan.exportable.length).toBe(0);
    expect(plan.notExportable.length).toBe(1);
    expect(plan.notExportable[0]?.metric).toBe('hitches');
    expect(plan.notExportable[0]?.reason).toContain('missing required columns');
  });

  it('allows filtering for specific metrics', () => {
    const { tables } = parseTocOutput(TOC_PHYSICAL_XCODE16);
    const plan = findMetricsInToc(tables, ['hitches', 'crash']);

    expect(plan.exportable.length).toBe(1); // hitches found
    expect(plan.exportable[0]?.metric).toBe('hitches');

    // Crash schema not in this TOC
    expect(plan.notExportable.length).toBe(1);
    expect(plan.notExportable[0]?.metric).toBe('crash');
  });

  it('handles empty tables list', () => {
    const plan = findMetricsInToc([]);

    expect(plan.exportable.length).toBe(0);
    expect(plan.notExportable.length).toBe(METRIC_SCHEMA_MAP.length);
  });
});

// ─── schemaToXPath ─────────────────────────────────────────────────

describe('schemaToXPath', () => {
  it('generates xctrace XPath for a schema', () => {
    const xpath = schemaToXPath('Hitch');
    expect(xpath).toBe('/trace-toc/run[@number="1"]/data/table[@schema="Hitch"]');
  });

  it('handles schema names with hyphens', () => {
    const xpath = schemaToXPath('os-signpost');
    expect(xpath).toBe('/trace-toc/run[@number="1"]/data/table[@schema="os-signpost"]');
  });

  it('handles schema names with dots', () => {
    const xpath = schemaToXPath('com.apple.dt.Energy');
    expect(xpath).toBe('/trace-toc/run[@number="1"]/data/table[@schema="com.apple.dt.Energy"]');
  });
});

// ─── generateExportXPaths ──────────────────────────────────────────

describe('generateExportXPaths', () => {
  it('generates XPaths for all exportable metrics', () => {
    const { tables } = parseTocOutput(TOC_PHYSICAL_XCODE16);
    const plan = findMetricsInToc(tables, ['hitches', 'launch']);
    const xpaths = generateExportXPaths(plan);

    expect(xpaths.length).toBe(2);
    expect(xpaths).toContain('/trace-toc/run[@number="1"]/data/table[@schema="Hitch"]');
    expect(xpaths).toContain('/trace-toc/run[@number="1"]/data/table[@schema="App Launch"]');
  });

  it('returns empty array when nothing is exportable', () => {
    const plan: ExportPlan = { exportable: [], notExportable: [] };
    const xpaths = generateExportXPaths(plan);
    expect(xpaths.length).toBe(0);
  });

  it('deduplicates XPaths when same schema appears multiple times', () => {
    const plan: ExportPlan = {
      exportable: [
        {
          metric: 'hitches',
          available: true,
          tables: [
            { schemaName: 'Hitch', tableName: 'Hitch', columns: ['hitch_ratio'] },
            { schemaName: 'Hitch', tableName: 'Hitch2', columns: ['hitch_duration'] },
          ],
        },
      ],
      notExportable: [],
    };
    const xpaths = generateExportXPaths(plan);
    expect(xpaths.length).toBe(1); // deduplicated
  });
});
