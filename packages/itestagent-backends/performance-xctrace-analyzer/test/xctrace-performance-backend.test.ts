/**
 * xctrace-performance-backend.test.ts — unit tests for XctracePerformanceBackend.
 *
 * Tests cover:
 *   - Factory creation (createXctracePerformanceBackend)
 *   - recordTrace returns valid ArtifactRef
 *   - exportTrace with mock CLI output
 *   - summarizeTrace parsing exported data
 *   - symbolicate delegation
 *   - compareBaseline delta computation
 *   - healthcheckXctrace availability check
 *   - R5 approximate flag propagation
 *   - Injectability of dependencies (test doubles)
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join as pathJoin, resolve as pathResolve } from 'node:path';

import type {
  BaselineCompareInput,
  BaselineDelta,
  PerformanceBackend,
  SymbolicateInput,
  TraceExportInput,
  TraceRecordInput,
  TraceSummary,
  TraceSummaryInput,
} from 'itestagent-contracts';
import type { SpawnSyncFn, SyncSpawnResult, XctraceCliDeps } from '../src/xctrace-cli.js';
import {
  createXctracePerformanceBackend,
  healthcheckXctrace,
} from '../src/xctrace-performance-backend.js';
import type { XctracePerformanceBackendDeps } from '../src/xctrace-performance-backend.js';

// ─── Fixtures ─────────────────────────────────────────────────────

const HITCHES_XML = `<?xml version="1.0"?>
<trace-export>
  <schema name="com.apple.xctrace.hitches_summary">
    <row><hitches-count>15</hitches-count><hitch-ratio>12.5</hitch-ratio><hitches-duration-ms>320</hitches-duration-ms></row>
  </schema>
  <schema name="com.apple.xctrace.hang">
    <row><hang-duration-ms>520</hang-duration-ms></row>
    <row><hang-duration-ms>180</hang-duration-ms></row>
    <row><hang-duration-ms>340</hang-duration-ms></row>
  </schema>
  <schema name="com.apple.xctrace.memory">
    <row><peak-memory-MB>418.5</peak-memory-MB></row>
  </schema>
  <schema name="com.apple.xctrace.launch">
    <row><launch-duration-ms>1320</launch-duration-ms></row>
  </schema>
</trace-export>`;

const TOC_OUTPUT = `Schema Name                              | Table Name
-----------------------------------------
Hitch                                    |
  Hitch                                  | hitches-count, hitch-ratio, hitches-duration-ms
os-signpost                              |
  os-signpost-intervals                  | annotation, category, duration_ms
Hangs                                    |
  Hangs                                  | hang-duration-ms
VM                                       |
  VM-operations                          | peak-memory-MB, size
App Launch                               |
  App Launch                             | launch-duration-ms
`;

// ─── Test doubles ─────────────────────────────────────────────────

function createMockSpawnSync(responses: Map<string, SyncSpawnResult>): SpawnSyncFn {
  return (_cmd: string, args: string[], _cwd?: string): SyncSpawnResult => {
    const key = args.join(' ');
    for (const [pattern, result] of responses.entries()) {
      if (key.includes(pattern)) {
        return result;
      }
    }
    return { exitCode: 1, stdout: '', stderr: `no mock for: ${key}` };
  };
}

function makeSuccessResult(stdout: string): SyncSpawnResult {
  return { exitCode: 0, stdout, stderr: '' };
}

function makeFailResult(stderr: string): SyncSpawnResult {
  return { exitCode: 1, stdout: '', stderr };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('createXctracePerformanceBackend', () => {
  it('creates a PerformanceBackend with default deps', () => {
    const backend = createXctracePerformanceBackend();
    expect(backend).toBeDefined();
    expect(typeof backend.recordTrace).toBe('function');
    expect(typeof backend.exportTrace).toBe('function');
    expect(typeof backend.summarizeTrace).toBe('function');
    expect(typeof backend.symbolicate).toBe('function');
    expect(typeof backend.compareBaseline).toBe('function');
  });

  it('accepts custom spawnSync dependency', () => {
    const customSpawn: SpawnSyncFn = () => ({ exitCode: 0, stdout: 'custom', stderr: '' });

    const backend = createXctracePerformanceBackend({ spawnSync: customSpawn });
    expect(backend).toBeDefined();
  });

  it('accepts isSimulator flag', () => {
    const backend = createXctracePerformanceBackend({ isSimulator: true });
    expect(backend).toBeDefined();
  });
});

describe('recordTrace', () => {
  const mockResponses = new Map<string, SyncSpawnResult>();

  function makeMockBackend(): PerformanceBackend {
    // recordTrace uses subprocessSpawn, which needs a real spawn function
    // but we use a mock that never actually spawns xcrun
    const mockSpawnSync: SpawnSyncFn = (_cmd, _args, _cwd) => {
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    // Mock subprocess spawn that returns a handle without running
    const mockSubprocessSpawn = ((_cmd: string, _args?: string[], _opts?: unknown) => {
      return {
        pid: 99999,
        exited: Promise.resolve({ exitCode: 0 }),
        kill: () => {},
        isAlive: () => false,
      };
    }) as unknown as NonNullable<XctracePerformanceBackendDeps['subprocessSpawn']>;

    return createXctracePerformanceBackend({
      spawnSync: mockSpawnSync,
      subprocessSpawn: mockSubprocessSpawn,
    });
  }

  it('returns an ArtifactRef with trace type', async () => {
    const backend = makeMockBackend();

    const input: TraceRecordInput = {
      deviceId: 'test-device-id',
      bundleId: 'com.example.app',
      template: 'all',
      durationSeconds: 10,
    };

    const result = await backend.recordTrace(input);

    expect(result).toBeDefined();
    expect(result.type).toBe('trace');
    expect(result.path).toContain('.trace');
    expect(result.redactionStatus).toBe('raw-local-only');
  });

  it('defaults template=all when not specified', async () => {
    const backend = makeMockBackend();

    const input: TraceRecordInput = {
      deviceId: 'test-device-id',
      bundleId: 'com.example.app',
    };

    const result = await backend.recordTrace(input);

    expect(result.type).toBe('trace');
  });
});

describe('exportTrace', () => {
  it('returns completed status with exported files on success', async () => {
    const responses = new Map<string, SyncSpawnResult>();
    responses.set('--toc', makeSuccessResult(TOC_OUTPUT));
    responses.set('--input', makeSuccessResult(HITCHES_XML));

    const backend = createXctracePerformanceBackend({
      spawnSync: createMockSpawnSync(responses),
    });

    const input: TraceExportInput = {
      deviceId: 'test-device-id',
      tracePath: '/tmp/test.trace',
      format: 'xml',
    };

    const result = await backend.exportTrace(input);

    expect(result.status).toBe('completed');
    expect(result.exportedFiles).toBeDefined();
    expect(result.exportedFiles?.length).toBe(3); // Hangs, VM, App Launch (Hitch excluded: hyphen columns mismatch required pattern underscores)
  });

  it('returns failed status when --toc fails', async () => {
    const responses = new Map<string, SyncSpawnResult>();
    responses.set('--toc', makeFailResult('no such file'));

    const backend = createXctracePerformanceBackend({
      spawnSync: createMockSpawnSync(responses),
    });

    const input: TraceExportInput = {
      deviceId: 'test-device-id',
      tracePath: '/tmp/nonexistent.trace',
    };

    const result = await backend.exportTrace(input);

    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('returns failed status when export fails', async () => {
    const responses = new Map<string, SyncSpawnResult>();
    responses.set('--toc', makeSuccessResult(TOC_OUTPUT));
    responses.set('--input', makeFailResult('export failed'));

    const backend = createXctracePerformanceBackend({
      spawnSync: createMockSpawnSync(responses),
    });

    const input: TraceExportInput = {
      deviceId: 'test-device-id',
      tracePath: '/tmp/test.trace',
    };

    const result = await backend.exportTrace(input);

    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });
});

describe('summarizeTrace', () => {
  const exportedXmlPath = pathResolve(tmpdir(), 'test-export.xml');

  beforeEach(() => {
    // Write fixture data to temp file
    Bun.write(exportedXmlPath, HITCHES_XML);
  });

  it('parses exported XML into TraceSummary', async () => {
    const backend = createXctracePerformanceBackend();

    const input: TraceSummaryInput = {
      deviceId: 'test-device-id',
      exportedPath: exportedXmlPath,
    };

    const summary = await backend.summarizeTrace(input);

    expect(summary.launchDurationMs).toBe(1320);
    expect(summary.memoryPeakMB).toBeCloseTo(418.5, 1);
    expect(summary.crashDetected).toBe(false);
    expect(summary.hangCount).toBe(3);
    expect(summary.approximate).toBe(true);
  });

  it('AC5: memory peak is always approximate', async () => {
    const backend = createXctracePerformanceBackend();

    const input: TraceSummaryInput = {
      deviceId: 'test-device-id',
      exportedPath: exportedXmlPath,
    };

    const summary = await backend.summarizeTrace(input);

    // R5: approximate must be true for xctrace-derived metrics
    expect(summary.approximate).toBe(true);
    // AC5: memory peak annotated as approximate (via the overall approximate flag)
    expect(summary.memoryPeakMB).toBeDefined();
  });

  it('returns minimal summary when export file is missing', async () => {
    const backend = createXctracePerformanceBackend();

    const input: TraceSummaryInput = {
      deviceId: 'test-device-id',
      exportedPath: '/tmp/nonexistent-file.xml',
    };

    const summary = await backend.summarizeTrace(input);

    expect(summary.approximate).toBe(true);
    // All optional fields should be undefined
    expect(summary.launchDurationMs).toBeUndefined();
    expect(summary.memoryPeakMB).toBeUndefined();
    expect(summary.hangCount).toBeUndefined();
  });

  it('R5: simulator target always has approximate=true', async () => {
    const backend = createXctracePerformanceBackend({ isSimulator: true });

    const input: TraceSummaryInput = {
      deviceId: 'simulator-id',
      exportedPath: exportedXmlPath,
    };

    const summary = await backend.summarizeTrace(input);

    // ADR-011: simulator performance data cannot represent physical device
    expect(summary.approximate).toBe(true);
  });
});

describe('symbolicate', () => {
  it('returns an ArtifactRef with crashlog type', async () => {
    const responses = new Map<string, SyncSpawnResult>();
    responses.set('symbolicatecrash', makeSuccessResult('symbolicated output'));

    const backend = createXctracePerformanceBackend({
      spawnSync: createMockSpawnSync(responses),
    });

    const input: SymbolicateInput = {
      deviceId: 'test-device-id',
      crashlogPath: '/tmp/test.crash',
    };

    const result = await backend.symbolicate(input);

    expect(result.type).toBe('crashlog');
    expect(result.redactionStatus).toBe('raw-local-only');
  });

  it('falls back to original crashlog path on failure', async () => {
    const responses = new Map<string, SyncSpawnResult>();
    responses.set('symbolicatecrash', makeFailResult('no dsym'));

    const backend = createXctracePerformanceBackend({
      spawnSync: createMockSpawnSync(responses),
    });

    const input: SymbolicateInput = {
      deviceId: 'test-device-id',
      crashlogPath: '/tmp/test.crash',
    };

    const result = await backend.symbolicate(input);

    expect(result.type).toBe('crashlog');
    expect(result.path).toBe('/tmp/test.crash');
  });
});

describe('compareBaseline', () => {
  it('returns BaselineDelta with inconclusive summary (no stored baseline)', async () => {
    const backend = createXctracePerformanceBackend();

    const currentSummary: TraceSummary = {
      launchDurationMs: 1320,
      memoryPeakMB: 418.5,
      crashDetected: false,
      hangCount: 3,
      hitchesSummary: { level: 'medium' },
      approximate: true,
    };

    const input: BaselineCompareInput = {
      deviceId: 'test-device-id',
      current: currentSummary,
      baselineId: 'baseline-001',
      targetKind: 'physical',
    };

    const delta = await backend.compareBaseline(input);

    expect(delta.baselineId).toBe('baseline-001');
    expect(delta.summary).toBe('inconclusive');
    expect(delta.runId).toBeDefined();
    expect(delta.comparedAt).toBeDefined();
  });

  it('ADR-011: preserves targetKind in delta output', async () => {
    const backend = createXctracePerformanceBackend();

    const currentSummary: TraceSummary = { approximate: true };

    const physicalInput: BaselineCompareInput = {
      deviceId: 'physical-device',
      current: currentSummary,
      baselineId: 'bl-001',
      targetKind: 'physical',
    };

    const simulatorInput: BaselineCompareInput = {
      deviceId: 'simulator-device',
      current: currentSummary,
      baselineId: 'bl-002',
      targetKind: 'simulator',
    };

    const physicalDelta = await backend.compareBaseline(physicalInput);
    const simDelta = await backend.compareBaseline(simulatorInput);

    expect(physicalDelta.targetKind).toBe('physical');
    expect(simDelta.targetKind).toBe('simulator');
  });
});

describe('healthcheckXctrace', () => {
  it('reports available when xctrace responds', () => {
    const responses = new Map<string, SyncSpawnResult>();
    responses.set('--version', makeSuccessResult('xctrace version 16.0'));

    const result = healthcheckXctrace({
      spawnSync: createMockSpawnSync(responses),
    });

    expect(result.available).toBe(true);
    expect(result.version).toBe('xctrace version 16.0');
  });

  it('reports unavailable when xctrace is missing', () => {
    const responses = new Map<string, SyncSpawnResult>();
    responses.set('--version', makeFailResult('command not found'));

    const result = healthcheckXctrace({
      spawnSync: createMockSpawnSync(responses),
    });

    expect(result.available).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── Integration-style: full record→export→summarize pipeline ────

describe('PerformanceBackend — full pipeline', () => {
  it('completes record→export→summarize with mock CLI', async () => {
    const responses = new Map<string, SyncSpawnResult>();
    responses.set('--toc', makeSuccessResult(TOC_OUTPUT));
    responses.set('--input', makeSuccessResult(HITCHES_XML));

    const mockSubprocessSpawn = ((_cmd: string, _args?: string[], _opts?: unknown) => {
      return {
        pid: 99999,
        exited: Promise.resolve({ exitCode: 0 }),
        kill: () => {},
        isAlive: () => false,
      };
    }) as unknown as NonNullable<XctracePerformanceBackendDeps['subprocessSpawn']>;

    const backend = createXctracePerformanceBackend({
      spawnSync: createMockSpawnSync(responses),
      subprocessSpawn: mockSubprocessSpawn,
      workDir: tmpdir(),
    });

    // Step 1: record
    const recordResult = await backend.recordTrace({
      deviceId: 'test-device',
      bundleId: 'com.example.app',
      template: 'all',
      durationSeconds: 5,
    });

    expect(recordResult.type).toBe('trace');
    expect(recordResult.path).toContain('.trace');

    // Step 2: export
    const exportResult = await backend.exportTrace({
      deviceId: 'test-device',
      tracePath: recordResult.path,
      format: 'xml',
    });

    expect(exportResult.status).toBe('completed');
    expect(exportResult.exportedFiles).toBeDefined();

    // Step 3: summarize
    if (!exportResult.exportedFiles?.[0]) throw new Error('no exported file');
    const exportedPath = exportResult.exportedFiles[0];
    // We need to ensure the file exists (mock writes it, but path needs to be real)
    // For mock-based tests, we wrote HITCHES_XML to the tmpdir
    Bun.write(exportedPath, HITCHES_XML);

    const summary = await backend.summarizeTrace({
      deviceId: 'test-device',
      exportedPath,
    });

    expect(summary).toBeDefined();
    expect(summary.launchDurationMs).toBe(1320);
    expect(summary.approximate).toBe(true);
  });
});

// ─── R5 compliance ────────────────────────────────────────────────

describe('R5 compliance', () => {
  it('summarizeTrace always returns approximate=true for xctrace data', async () => {
    const exportedPath = pathResolve(tmpdir(), 'r5-test.xml');
    Bun.write(exportedPath, HITCHES_XML);

    const backend = createXctracePerformanceBackend();

    const summary = await backend.summarizeTrace({
      deviceId: 'test-device',
      exportedPath,
    });

    expect(summary.approximate).toBe(true);
  });

  it('all optional metrics can be undefined — R5: no fabricated data', async () => {
    const emptyPath = pathResolve(tmpdir(), 'empty.xml');
    Bun.write(emptyPath, '<?xml version="1.0"?><trace-export></trace-export>');

    const backend = createXctracePerformanceBackend();

    const summary = await backend.summarizeTrace({
      deviceId: 'test-device',
      exportedPath: emptyPath,
    });

    // R5: if data isn't available, fields should be undefined — never fabricated
    expect(summary.launchDurationMs).toBeUndefined();
    expect(summary.memoryPeakMB).toBeUndefined();
    expect(summary.crashDetected).toBeFalsy();
    expect(summary.hangCount).toBe(0);
    expect(summary.approximate).toBe(true);
  });
});
