import { describe, expect, it } from 'bun:test';
import {
  createRealXcunitFlowDeps,
  defaultXcunitProcessRunner,
} from '../../src/test-flow/xcunit-flow-wiring.js';

const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

describe('xcunit-flow-wiring', () => {
  it.skipIf(IS_CI)('default runner completes a short process without a signal', async () => {
    const result = await defaultXcunitProcessRunner('bun', ['-e', 'console.log("ok")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });

  it.skipIf(IS_CI)(
    'default runner forwards AbortSignal — in-flight child is terminated',
    async () => {
      const controller = new AbortController();
      const pending = defaultXcunitProcessRunner('bun', ['-e', 'await Bun.sleep(10_000)'], {
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 100);
      const result = await pending;
      expect(result.exitCode).not.toBe(0);
    },
    15_000,
  );

  it('builds real deps with an injected runner override', () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const deps = createRealXcunitFlowDeps(async (cmd, args) => {
      calls.push({ cmd, args });
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    expect(typeof deps.runTests).toBe('function');
    expect(typeof deps.parse).toBe('function');
  });
});
