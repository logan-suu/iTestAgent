/**
 * Phase 4 integration — xcresult parsing pipeline.
 *
 * Verifies the XcresultParser JUnit XML → normalized TestCaseResult chain.
 * Uses real filesystem paths for xcresultPath existence checks, then mock
 * spawnAsync for CLI output.
 *
 * P1: XcresultParser → JUnit XML regex → TestCaseResult[]
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createXcresultParser } from 'itestagent-backends-analyzer-xcresult';
import type { SpawnAsyncFn } from 'itestagent-backends-analyzer-xcresult';

// ─── Mock spawnAsync ─────────────────────────────────────────

function mockSpawnAsync(
  junitXml: string,
  junitExitCode = 0,
  targetInfoOutput = '',
  targetInfoExitCode = 0,
): SpawnAsyncFn {
  let callCount = 0;
  return async (_cmd: string, _args: string[], _opts?: unknown) => {
    callCount++;
    if (callCount === 1) {
      return { stdout: junitXml, stderr: '', exitCode: junitExitCode };
    }
    return { stdout: targetInfoOutput, stderr: '', exitCode: targetInfoExitCode };
  };
}

// ─── JUnit XML Fixtures ─────────────────────────────────────

function jUnitXml(entries: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    `  <testsuite name="Tests" tests="${entries.length}" failures="0" errors="0" time="12.5" timestamp="2026-07-28T10:00:00Z">`,
    ...entries.map((e) => `    ${e}`),
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');
}

function passedCase(name: string, className: string, timeSec = '0.5'): string {
  return `<testcase classname="${className}" name="${name}" time="${timeSec}"></testcase>`;
}

function failedCase(name: string, className: string, message: string, timeSec = '0.8'): string {
  return `<testcase classname="${className}" name="${name}" time="${timeSec}"><failure message="${message}">Assertion failed</failure></testcase>`;
}

function skippedCase(name: string, className: string): string {
  return `<testcase classname="${className}" name="${name}" time="0.0"><skipped/></testcase>`;
}

function erroredCase(name: string, className: string, message: string): string {
  return `<testcase classname="${className}" name="${name}" time="2.0"><error message="${message}">Stack trace</error></testcase>`;
}

// ─── Helpers ─────────────────────────────────────────────────

function tmpXcresultDir(): string {
  return mkdtempSync(join(tmpdir(), 'phase4-xcresult-'));
}

// ─── Tests ───────────────────────────────────────────────────

describe('Phase 4 xcresult Pipeline', () => {
  it('parses all-passing single-suite JUnit XML', async () => {
    const xml = jUnitXml([
      passedCase('testLogin', 'LoginTests'),
      passedCase('testLogout', 'LoginTests'),
      passedCase('testProfile', 'ProfileTests'),
    ]);

    const xcresultPath = tmpXcresultDir();
    try {
      const mockSpawn = mockSpawnAsync(xml, 0, 'LoginTests\nProfileTests');
      const parser = createXcresultParser({ spawnAsync: mockSpawn });
      const result = await parser.parse({ xcresultPath });

      expect(result.error).toBeUndefined();
      expect(result.cases.length).toBe(3);
      expect(result.cases.every((c) => c.status === 'passed')).toBe(true);
      expect(result.cases[0]?.name).toBe('testLogin');
      expect(result.cases[1]?.name).toBe('testLogout');
      expect(result.cases[2]?.name).toBe('testProfile');
      expect(result.execution.passed).toBe(3);
      expect(result.execution.failed).toBe(0);
      expect(result.execution.targetNames).toContain('LoginTests');
    } finally {
      rmdirSync(xcresultPath, { recursive: true });
    }
  });

  it('parses mixed pass/fail/skip cases', async () => {
    const xml = jUnitXml([
      passedCase('testA', 'Suite1'),
      failedCase('testB', 'Suite1', 'expected true got false'),
      skippedCase('testC', 'Suite1'),
    ]);

    const xcresultPath = tmpXcresultDir();
    try {
      const mockSpawn = mockSpawnAsync(xml);
      const parser = createXcresultParser({ spawnAsync: mockSpawn });
      const result = await parser.parse({ xcresultPath });

      expect(result.cases.length).toBe(3);
      const passed = result.cases.filter((c) => c.status === 'passed');
      const failed = result.cases.filter((c) => c.status === 'failed');
      const inconclusive = result.cases.filter((c) => c.status === 'inconclusive');

      expect(passed.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(inconclusive.length).toBe(1);
      expect(failed[0]?.error).toContain('expected true got false');
      expect(result.execution.passed).toBe(1);
      expect(result.execution.failed).toBe(1);
    } finally {
      rmdirSync(xcresultPath, { recursive: true });
    }
  });

  it('parses error cases as failed', async () => {
    const xml = jUnitXml([erroredCase('testCrash', 'CrashTests', 'SIGABRT at 0xdeadbeef')]);

    const xcresultPath = tmpXcresultDir();
    try {
      const mockSpawn = mockSpawnAsync(xml);
      const parser = createXcresultParser({ spawnAsync: mockSpawn });
      const result = await parser.parse({ xcresultPath });

      expect(result.cases.length).toBe(1);
      expect(result.cases[0]?.status).toBe('failed');
      expect(result.cases[0]?.error).toContain('SIGABRT');
      expect(result.execution.totalTests).toBe(1);
    } finally {
      rmdirSync(xcresultPath, { recursive: true });
    }
  });

  it('parses multi-suite JUnit XML aggregating metadata', async () => {
    const multiSuiteXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites>',
      '  <testsuite name="SuiteA" tests="2" failures="1" errors="0" time="5.0" timestamp="2026-07-28T10:00:00Z">',
      `    ${passedCase('testA1', 'SuiteA')}`,
      `    ${failedCase('testA2', 'SuiteA', 'mismatch')}`,
      '  </testsuite>',
      '  <testsuite name="SuiteB" tests="1" failures="0" errors="0" time="3.0" timestamp="2026-07-28T10:05:00Z">',
      `    ${passedCase('testB1', 'SuiteB', '1.2')}`,
      '  </testsuite>',
      '</testsuites>',
    ].join('\n');

    const xcresultPath = tmpXcresultDir();
    try {
      const mockSpawn = mockSpawnAsync(multiSuiteXml);
      const parser = createXcresultParser({ spawnAsync: mockSpawn });
      const result = await parser.parse({ xcresultPath });

      expect(result.cases.length).toBe(3);
      expect(result.execution.totalTests).toBe(3);
      expect(result.execution.passed).toBe(2);
      expect(result.execution.failed).toBe(1);
    } finally {
      rmdirSync(xcresultPath, { recursive: true });
    }
  });

  it('returns empty results on non-zero exit code (R5 — no throw)', async () => {
    const xcresultPath = tmpXcresultDir();
    try {
      const mockSpawn = mockSpawnAsync('', 1);
      const parser = createXcresultParser({ spawnAsync: mockSpawn });
      const result = await parser.parse({ xcresultPath });

      expect(result.cases).toEqual([]);
      expect(result.execution.totalTests).toBe(0);
      expect(result.error).toBeDefined();
    } finally {
      rmdirSync(xcresultPath, { recursive: true });
    }
  });

  it('returns empty results on missing xcresultPath (R5 — no throw)', async () => {
    const mockSpawn = mockSpawnAsync('');
    const parser = createXcresultParser({ spawnAsync: mockSpawn });
    const result = await parser.parse({ xcresultPath: '/nonexistent/path.xcresult' });

    expect(result.cases).toEqual([]);
    expect(result.error).toContain('does not exist');
  });

  it('handles empty testsuite element gracefully', async () => {
    const emptyXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites>',
      '  <testsuite name="EmptySuite" tests="0" failures="0" errors="0" time="0" timestamp="2026-07-28T10:00:00Z">',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n');

    const xcresultPath = tmpXcresultDir();
    try {
      const mockSpawn = mockSpawnAsync(emptyXml);
      const parser = createXcresultParser({ spawnAsync: mockSpawn });
      const result = await parser.parse({ xcresultPath });

      expect(result.cases).toEqual([]);
      expect(result.execution.totalTests).toBe(0);
    } finally {
      rmdirSync(xcresultPath, { recursive: true });
    }
  });

  it('preserves test case duration in milliseconds', async () => {
    const xml = jUnitXml([
      passedCase('testFast', 'PerformanceTests', '0.01'),
      passedCase('testSlow', 'PerformanceTests', '3.5'),
    ]);

    const xcresultPath = tmpXcresultDir();
    try {
      const mockSpawn = mockSpawnAsync(xml);
      const parser = createXcresultParser({ spawnAsync: mockSpawn });
      const result = await parser.parse({ xcresultPath });

      expect(result.cases.length).toBe(2);
      expect(result.cases[0]?.durationMs).toBe(10);
      expect(result.cases[1]?.durationMs).toBe(3500);
    } finally {
      rmdirSync(xcresultPath, { recursive: true });
    }
  });
});
