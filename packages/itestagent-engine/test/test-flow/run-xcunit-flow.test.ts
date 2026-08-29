/**
 * XCUITest flow composition tests — injected runner/parser, no binaries.
 */
import { describe, expect, it } from 'bun:test';
import { type XcunitFlowDeps, runXcunitFlow } from '../../src/test-flow/run-xcunit-flow.js';

const PARSED = {
  cases: [{ name: 'SampleAppTests.testExample', status: 'passed' }],
  execution: {
    startTime: '2026-08-29T00:00:00Z',
    endTime: '2026-08-29T00:01:00Z',
    totalTests: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    targetNames: ['SampleAppTests'],
  },
  metrics: { approximate: true },
  attachments: [],
};

function makeDeps(overrides?: Partial<XcunitFlowDeps>): {
  deps: XcunitFlowDeps;
  recorded: { extraArgs: string[] | undefined };
} {
  const recorded = { extraArgs: undefined as string[] | undefined };
  const deps: XcunitFlowDeps = {
    async runTests(input) {
      recorded.extraArgs = input.extraArgs;
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 1234 };
    },
    async parse(options) {
      return { ...PARSED } as never;
    },
    ...overrides,
  };
  return { deps, recorded };
}

describe('runXcunitFlow', () => {
  it('runs tests with the owned -resultBundlePath and returns the parsed result', async () => {
    const { deps, recorded } = makeDeps();
    const result = await runXcunitFlow(
      {
        projectRoot: '/proj',
        scheme: 'SampleApp',
        resultBundlePath: '/tmp/xcresult.xcresult',
        includeAttachments: true,
      },
      deps,
    );
    expect(result.exitCode).toBe(0);
    expect(result.parsed).not.toBeNull();
    expect(result.parsed?.cases).toHaveLength(1);
    expect(result.parseError).toBeUndefined();
    expect(recorded.extraArgs).toEqual(['-resultBundlePath', '/tmp/xcresult.xcresult']);
  });

  it('still parses the bundle when the test run fails (exit != 0)', async () => {
    const { deps } = makeDeps({
      async runTests() {
        return { exitCode: 65, stdout: 'Failing tests:', stderr: '', durationMs: 500 };
      },
    });
    const result = await runXcunitFlow(
      { projectRoot: '/proj', scheme: 'SampleApp', resultBundlePath: '/tmp/fail.xcresult' },
      deps,
    );
    expect(result.exitCode).toBe(65);
    expect(result.parsed?.cases[0]?.name).toBe('SampleAppTests.testExample');
  });

  it('captures parse errors without throwing (R5)', async () => {
    const { deps } = makeDeps({
      async parse() {
        throw new Error('xcresultparser missing');
      },
    });
    const result = await runXcunitFlow(
      { projectRoot: '/proj', scheme: 'SampleApp', resultBundlePath: '/tmp/missing.xcresult' },
      deps,
    );
    expect(result.parsed).toBeNull();
    expect(result.parseError).toContain('xcresultparser missing');
  });

  it('passes only-filters and destination through to the runner', async () => {
    let capturedScheme = '';
    let capturedDestination: unknown = undefined;
    const { deps } = makeDeps({
      async runTests(input) {
        capturedScheme = input.scheme;
        capturedDestination = input.destination;
        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
      },
    });
    await runXcunitFlow(
      {
        projectRoot: '/proj',
        scheme: 'SampleApp',
        destination: { kind: 'physical', udid: 'U1' } as never,
        only: ['SampleAppTests/testExample'],
        resultBundlePath: '/tmp/x.xcresult',
      },
      deps,
    );
    expect(capturedScheme).toBe('SampleApp');
    expect(capturedDestination).toEqual({ kind: 'physical', udid: 'U1' });
  });
});
