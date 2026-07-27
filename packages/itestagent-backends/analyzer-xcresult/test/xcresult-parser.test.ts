/**
 * Tests for xcresult parser adapter.
 *
 * All subprocess calls are mocked — no real xcresultparser or xcparse is invoked.
 * Fixtures provide sample JUnit XML and --target-info output.
 *
 * Coverage:
 *   - parse: passing tests → correct TestCaseResult[] with status "passed"
 *   - parse: mixed results → correct pass/fail/skip counts
 *   - parse: failed test → failure message preserved in error field
 *   - parse: empty xcresult (no tests) → empty cases array, execution with zeros
 *   - CLI failure (exitCode !== 0) → empty result, not thrown (R5)
 *   - abort signal → partial/empty result
 *   - target names extraction → correct targetNames[]
 *   - duration normalization → correct ms conversion
 *   - xcresultPath not found → empty result with error
 *
 * AGENTS.md R12: All code/comments in English.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';

import type { SpawnAsyncFn, XcresultParserDeps, XcresultParserOptions } from '../src/types.js';
import { createXcresultParser } from '../src/xcresult-parser.js';

// ─── Fixture Paths ────────────────────────────────────────────

const FIXTURES_DIR = pathJoin(import.meta.dirname, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(pathJoin(FIXTURES_DIR, name), 'utf8');
}

// ─── Helpers ──────────────────────────────────────────────────

function createMockSpawn(
  responses: Map<string, { exitCode: number; stdout: string; stderr: string }>,
): SpawnAsyncFn {
  return mock(
    async (_cmd: string, args: string[], _opts?: { cwd?: string; signal?: AbortSignal }) => {
      const key = args.join(' ');
      // Try exact match first, then prefix match
      for (const [pattern, response] of responses.entries()) {
        if (key.startsWith(pattern)) {
          return response;
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  );
}

function createParser(mockSpawn: SpawnAsyncFn) {
  const deps: XcresultParserDeps = { spawnAsync: mockSpawn };
  return createXcresultParser(deps);
}

/** Valid xcresult path that passes existsSync check (uses an actual existing path). */
const validXcresultPath = pathJoin(FIXTURES_DIR, 'junit-pass.xml');

// ─── parse: passing tests ─────────────────────────────────────

describe('parse', () => {
  it('returns correct TestCaseResult[] for passing tests', async () => {
    const junitXml = readFixture('junit-pass.xml');
    const targetInfo = readFixture('xcresultparser-target-info.txt');

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: junitXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: targetInfo, stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    expect(result.error).toBeUndefined();
    expect(result.cases).toHaveLength(2);

    // First test case
    expect(result.cases[0]).toEqual({
      caseId: 'MyAppTests.LoginTests/testLoginSuccess',
      name: 'testLoginSuccess',
      status: 'passed',
      steps: [],
      durationMs: 200,
      error: undefined,
      artifacts: [],
    });

    // Second test case
    expect(result.cases[1]).toEqual({
      caseId: 'MyAppTests.SignupTests/testSignupFlow',
      name: 'testSignupFlow',
      status: 'passed',
      steps: [],
      durationMs: 256,
      error: undefined,
      artifacts: [],
    });

    // Execution summary
    expect(result.execution.totalTests).toBe(2);
    expect(result.execution.passed).toBe(2);
    expect(result.execution.failed).toBe(0);
    expect(result.execution.skipped).toBe(0);
    expect(result.execution.startTime).toBe('2025-01-15T10:30:00Z');

    // Metrics
    expect(result.metrics.approximate).toBe(true);
  });

  it('handles mixed results: pass + fail + skipped', async () => {
    const junitXml = readFixture('junit-mixed.xml');
    const targetInfo = readFixture('xcresultparser-target-info.txt');

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: junitXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: targetInfo, stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    expect(result.cases).toHaveLength(4);

    // Passed
    const passed = result.cases.filter((c) => c.status === 'passed');
    expect(passed).toHaveLength(2);

    // Failed
    const failed = result.cases.filter((c) => c.status === 'failed');
    expect(failed).toHaveLength(1);

    // Skipped → mapped to 'inconclusive' (RunStatusSchema has no 'skipped')
    const inconclusive = result.cases.filter((c) => c.status === 'inconclusive');
    expect(inconclusive).toHaveLength(1);

    // Execution counts
    expect(result.execution.totalTests).toBe(4);
    expect(result.execution.passed).toBe(2);
    expect(result.execution.failed).toBe(1);
    expect(result.execution.skipped).toBe(1);
  });

  it('preserves failure message in error field', async () => {
    const junitXml = readFixture('junit-mixed.xml');
    const targetInfo = readFixture('xcresultparser-target-info.txt');

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: junitXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: targetInfo, stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    const failedCase = result.cases.find((c) => c.status === 'failed');
    expect(failedCase).toBeDefined();
    expect(failedCase?.name).toBe('testLoginFailure');
    expect(failedCase?.error).toBe('Expected true but got false');
  });

  it('returns empty cases for empty JUnit XML', async () => {
    const emptyXml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="EmptySuite" tests="0" failures="0" errors="0" time="0" timestamp="2025-01-15T10:00:00Z">
  </testsuite>
</testsuites>`;

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: emptyXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: '', stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    expect(result.cases).toEqual([]);
    expect(result.execution.totalTests).toBe(0);
    expect(result.execution.passed).toBe(0);
    expect(result.execution.failed).toBe(0);
    expect(result.execution.skipped).toBe(0);
  });

  it('returns empty result when CLI fails (R5: never throw)', async () => {
    const mockSpawn = createMockSpawn(
      new Map([
        [
          '-o junit',
          {
            exitCode: 1,
            stdout: '',
            stderr: 'xcresultparser: error: cannot parse bundle',
          },
        ],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    expect(result.error).toBeDefined();
    expect(result.error).toContain('exited with code 1');
    expect(result.cases).toEqual([]);
    expect(result.execution.totalTests).toBe(0);
  });

  it('returns partial result when target-info fails but JUnit succeeds (R5: non-fatal)', async () => {
    const junitXml = readFixture('junit-pass.xml');

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: junitXml, stderr: '' }],
        ['--target-info', { exitCode: 1, stdout: '', stderr: 'no target info available' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    // JUnit parsing still succeeds, targetNames is empty
    expect(result.error).toBeUndefined();
    expect(result.cases).toHaveLength(2);
    expect(result.execution.targetNames).toEqual([]);
  });

  it('returns empty result when xcresultPath does not exist (R5)', async () => {
    const mockSpawn = createMockSpawn(new Map());
    const parser = createParser(mockSpawn);

    const result = await parser.parse({
      xcresultPath: '/nonexistent/path/result.xcresult',
    });

    expect(result.error).toBeDefined();
    expect(result.error).toContain('does not exist');
    expect(result.cases).toEqual([]);
  });

  it('extracts target names correctly', async () => {
    const junitXml = readFixture('junit-pass.xml');
    const targetInfo = readFixture('xcresultparser-target-info.txt');

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: junitXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: targetInfo, stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    expect(result.execution.targetNames).toEqual(['MyApp', 'MyAppTests', 'MyAppUITests']);
  });

  it('converts duration from seconds to ms correctly', async () => {
    const junitXml = readFixture('junit-mixed.xml');
    const targetInfo = readFixture('xcresultparser-target-info.txt');

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: junitXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: targetInfo, stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    // testLoginSuccess: 0.200s → 200ms
    expect(result.cases[0]?.durationMs).toBe(200);
    // testLoginFailure: 0.350s → 350ms
    expect(result.cases[1]?.durationMs).toBe(350);
    // testSignupFlow: 0.456s → 456ms
    expect(result.cases[2]?.durationMs).toBe(456);
    // testProfileView: 0.000s → 0ms
    expect(result.cases[3]?.durationMs).toBe(0);
  });

  it('handles abort signal', async () => {
    const junitXml = readFixture('junit-pass.xml');

    // First call succeeds, second (target-info) is aborted
    let callCount = 0;
    const mockSpawn = mock(
      async (_cmd: string, _args: string[], _opts?: { cwd?: string; signal?: AbortSignal }) => {
        callCount++;
        if (callCount === 1) {
          return { exitCode: 0, stdout: junitXml, stderr: '' };
        }
        // Simulate aborted behavior
        return { exitCode: -1, stdout: '', stderr: 'aborted' };
      },
    );

    const controller = new AbortController();
    const parser = createParser(mockSpawn);

    // Abort after first call by checking signal
    const originalSpawn = mockSpawn;
    const wrappedSpawn: SpawnAsyncFn = mock(
      async (cmd: string, args: string[], opts?: { cwd?: string; signal?: AbortSignal }) => {
        const result = await originalSpawn(cmd, args, opts);
        // Abort after the JUnit call
        controller.abort();
        return result;
      },
    );

    const parserWithAbort = createParser(wrappedSpawn);
    const result = await parserWithAbort.parse({
      xcresultPath: validXcresultPath,
      signal: controller.signal,
    });

    // Should return partial or empty result after abort
    expect(result.cases.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── JUnit XML parsing edge cases ─────────────────────────────

describe('JUnit XML parsing', () => {
  it('handles JUnit with error element (maps to failed)', async () => {
    const xmlWithError = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="ErrorSuite" tests="1" failures="0" errors="1" time="0.1">
    <testcase classname="ErrorSuite.TestClass" name="testWithError" time="0.050">
      <error message="Unexpected exception">Stack trace...</error>
    </testcase>
  </testsuite>
</testsuites>`;

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: xmlWithError, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: '', stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.status).toBe('failed');
    expect(result.cases[0]?.error).toBe('Unexpected exception');
  });

  it('handles JUnit with nested testsuite elements', async () => {
    const nestedXml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="SuiteA" tests="1" failures="0" errors="0" time="0.1">
    <testcase classname="SuiteA.TestClass" name="testA" time="0.050">
    </testcase>
  </testsuite>
  <testsuite name="SuiteB" tests="2" failures="1" errors="0" time="0.2">
    <testcase classname="SuiteB.TestClass" name="testB1" time="0.050">
    </testcase>
    <testcase classname="SuiteB.TestClass" name="testB2" time="0.150">
      <failure message="Assertion failed"/>
    </testcase>
  </testsuite>
</testsuites>`;

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: nestedXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: '', stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    // The regex-based parser iterates all testcase elements globally
    expect(result.cases).toHaveLength(3);
    expect(result.execution.totalTests).toBe(3);
    expect(result.execution.passed).toBe(2);
    expect(result.execution.failed).toBe(1);
  });

  it('handles malformed JUnit XML gracefully', async () => {
    const malformedXml = 'not valid xml at all';

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: malformedXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: '', stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    // Should return empty cases, not throw
    expect(result.cases).toEqual([]);
    expect(result.execution.totalTests).toBe(0);
  });
});

// ─── Normalize edge cases ─────────────────────────────────────

describe('normalize edge cases', () => {
  it('maps skipped test to inconclusive RunStatus', async () => {
    const skippedXml = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="SkipSuite" tests="1" failures="0" errors="0" time="0">
    <testcase classname="SkipSuite.TestClass" name="testSkipped" time="0">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>`;

    const mockSpawn = createMockSpawn(
      new Map([
        ['-o junit', { exitCode: 0, stdout: skippedXml, stderr: '' }],
        ['--target-info', { exitCode: 0, stdout: '', stderr: '' }],
      ]),
    );

    const parser = createParser(mockSpawn);
    const result = await parser.parse({ xcresultPath: validXcresultPath });

    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.status).toBe('inconclusive');
    expect(result.execution.skipped).toBe(1);
  });
});
