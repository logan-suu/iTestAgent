/**
 * Tests for xctrace-cli enhanced functions (Task 4.4).
 *
 * Tests extractXcodeVersion, listTraceSchemasParsed, exportXctraceSelective.
 */

import { describe, expect, it } from 'bun:test';
import type { SpawnSyncFn, SyncSpawnResult } from '../src/xctrace-cli.js';
import {
  exportXctraceSelective,
  extractXcodeVersion,
  listTraceSchemasParsed,
} from '../src/xctrace-cli.js';

// ─── Helpers ────────────────────────────────────────────────────────

/** Create a mock spawnSync that returns predetermined results. */
function mockSpawnSync(responses: Record<string, SyncSpawnResult>): SpawnSyncFn {
  return (_cmd: string, args: string[], _cwd?: string) => {
    const key = args.join(' ');
    for (const [pattern, result] of Object.entries(responses)) {
      if (key.includes(pattern)) {
        return result;
      }
    }
    return { exitCode: 1, stdout: '', stderr: `Unexpected args: ${key}` };
  };
}

function spawnSuccess(stdout: string): SyncSpawnResult {
  return { exitCode: 0, stdout, stderr: '' };
}

function spawnFailure(stderr: string): SyncSpawnResult {
  return { exitCode: 1, stdout: '', stderr };
}

// ─── Minimal TOC fixture for selective export tests ──────────────────

const TOC_ALL_SCHEMAS = `
Schema Name                              | Table Name
-----------------------------------------
Hitch                                    |
  Hitch                                  | hitch_ratio, hitch_duration_ms
App Launch                               |
  App Launch                             | launch_type, duration_ms
Hangs                                    |
  Hangs                                  | hang_duration_ms
VM                                       |
  VM-operations                          | size, address
`;

const SPY_TOC_XML =
  '<trace-toc><run number="1"><data><table schema="Hitch">...</table></data></run></trace-toc>';
const SPY_LAUNCH_XML =
  '<trace-toc><run number="1"><data><table schema="App Launch">...</table></data></run></trace-toc>';

// ─── extractXcodeVersion ────────────────────────────────────────────

describe('extractXcodeVersion', () => {
  it('extracts Xcode 16.0 version', () => {
    const spawnSync = mockSpawnSync({
      version: spawnSuccess('xctrace version 16.0 (2040.3)\n'),
    });
    const version = extractXcodeVersion(spawnSync);
    expect(version).not.toBeNull();
    expect(version?.major).toBe(16);
    expect(version?.minor).toBe(0);
  });

  it('returns null when xctrace is not available', () => {
    const spawnSync = mockSpawnSync({
      version: spawnFailure('xcrun: error: unable to find utility "xctrace"'),
    });
    const version = extractXcodeVersion(spawnSync);
    expect(version).toBeNull();
  });

  it('returns null for unparseable version string', () => {
    const spawnSync = mockSpawnSync({
      version: spawnSuccess('unknown output\n'),
    });
    const version = extractXcodeVersion(spawnSync);
    expect(version).toBeNull();
  });
});

// ─── listTraceSchemasParsed ──────────────────────────────────────────

describe('listTraceSchemasParsed', () => {
  it('parses TOC output into structured tables', () => {
    const spawnSync = mockSpawnSync({
      '--toc': spawnSuccess(TOC_ALL_SCHEMAS),
    });
    const deps = { spawnSync, subprocessSpawn: undefined as never, workDir: '/tmp' };
    const result = listTraceSchemasParsed(deps, '/tmp/trace.trace');

    expect(result.success).toBe(true);
    expect(result.tables.length).toBe(4);
    expect(result.tables.some((t) => t.schemaName === 'Hitch')).toBe(true);
    expect(result.tables.some((t) => t.schemaName === 'App Launch')).toBe(true);
  });

  it('returns failure when xctrace export --toc fails', () => {
    const spawnSync = mockSpawnSync({
      '--toc': spawnFailure('xctrace: No such file'),
    });
    const deps = { spawnSync, subprocessSpawn: undefined as never, workDir: '/tmp' };
    const result = listTraceSchemasParsed(deps, '/invalid.trace');

    expect(result.success).toBe(false);
    expect(result.tables).toEqual([]);
  });
});

// ─── exportXctraceSelective ─────────────────────────────────────────

describe('exportXctraceSelective', () => {
  it('selectively exports hitches and launch schemas via XPath', () => {
    const spawnSync = mockSpawnSync({
      '--toc': spawnSuccess(TOC_ALL_SCHEMAS),
      '--xpath /trace-toc/run[@number="1"]/data/table[@schema="Hitch"]': spawnSuccess(SPY_TOC_XML),
      '--xpath /trace-toc/run[@number="1"]/data/table[@schema="App Launch"]':
        spawnSuccess(SPY_LAUNCH_XML),
    });
    const deps = { spawnSync, subprocessSpawn: undefined as never, workDir: '/tmp' };

    const result = exportXctraceSelective(deps, '/tmp/trace.trace');

    expect(result.success).toBe(true);
    expect(Object.keys(result.exported)).toContain('Hitch');
    expect(Object.keys(result.exported)).toContain('App Launch');
    expect(result.exported.Hitch).toBe(SPY_TOC_XML);
    expect(result.exported['App Launch']).toBe(SPY_LAUNCH_XML);
  });

  it('marks metrics as notExportable when schema missing from TOC', () => {
    // Simulator TOC: only App Launch and os-signpost available, no Hitch/Hangs/VM
    const simulatorToc = `
Schema Name                              | Table Name
-----------------------------------------
App Launch                               |
  App Launch                             | launch_type, duration_ms
`;
    const spawnSync = mockSpawnSync({
      '--toc': spawnSuccess(simulatorToc),
      '--xpath /trace-toc/run[@number="1"]/data/table[@schema="App Launch"]':
        spawnSuccess(SPY_LAUNCH_XML),
    });
    const deps = { spawnSync, subprocessSpawn: undefined as never, workDir: '/tmp' };

    const result = exportXctraceSelective(deps, '/tmp/simulator.trace');

    expect(result.success).toBe(true);
    expect(Object.keys(result.exported)).toContain('App Launch');

    // Hitches and memory should be not_exportable on simulator
    const hitchesUnavailable = result.notExportable.find((n) => n.metric === 'hitches');
    expect(hitchesUnavailable).toBeDefined();
    expect(hitchesUnavailable?.reason).toContain('No schema matching');

    const memoryUnavailable = result.notExportable.find((n) => n.metric === 'memory');
    expect(memoryUnavailable).toBeDefined();
  });

  it('handles TOC listing failure gracefully', () => {
    const spawnSync = mockSpawnSync({
      '--toc': spawnFailure('xctrace: corrupted trace file'),
    });
    const deps = { spawnSync, subprocessSpawn: undefined as never, workDir: '/tmp' };

    const result = exportXctraceSelective(deps, '/tmp/corrupted.trace');

    expect(result.success).toBe(false);
    expect(Object.keys(result.exported)).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles individual schema export failures without breaking others', () => {
    const spawnSync = mockSpawnSync({
      '--toc': spawnSuccess(TOC_ALL_SCHEMAS),
      '--xpath /trace-toc/run[@number="1"]/data/table[@schema="Hitch"]':
        spawnFailure('Export failed for Hitch'),
      '--xpath /trace-toc/run[@number="1"]/data/table[@schema="App Launch"]':
        spawnSuccess(SPY_LAUNCH_XML),
      '--xpath /trace-toc/run[@number="1"]/data/table[@schema="Hangs"]':
        spawnFailure('Export failed for Hangs'),
      '--xpath /trace-toc/run[@number="1"]/data/table[@schema="VM"]': spawnSuccess('<VM/>'),
    });
    const deps = { spawnSync, subprocessSpawn: undefined as never, workDir: '/tmp' };

    const result = exportXctraceSelective(deps, '/tmp/partial.trace');

    expect(result.success).toBe(true); // partial success still counts
    expect(Object.keys(result.exported)).toContain('App Launch');
    expect(Object.keys(result.exported)).toContain('VM');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.notExportable.some((n) => n.metric === 'hitches')).toBe(true);
    expect(result.notExportable.some((n) => n.metric === 'hangs')).toBe(true);
  });
});

// ─── B21 seam: shared XML helpers ──────────────────────────────────

describe('B21 seam: shared XML extraction helpers', () => {
  it('extracts attributes through the split module', async () => {
    const mod = await import('../src/xctrace-xml.js');
    expect(mod.extractAttribute('<row key="a" value="b">', 'key')).toBe('a');
  });
});
