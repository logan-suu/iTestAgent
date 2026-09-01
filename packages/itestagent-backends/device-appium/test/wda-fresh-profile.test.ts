/**
 * ensureFreshProfile tests — 7-day free-profile re-sign routine
 * (G5 recipe): verify → skip when ready → rebuild (R7-gated) otherwise.
 */
import { describe, expect, it } from 'bun:test';
import type { WdaPreinstallVerification } from '../src/wda-manager.js';
import { type FreshProfileOps, ensureFreshProfile } from '../src/wda-manager.js';

const INSTALLED: WdaPreinstallVerification = {
  installed: true,
  ready: false,
  actualBundleId: 'T.WDA.xctrunner',
  reason: 'active readiness not probed',
};
const NOT_INSTALLED: WdaPreinstallVerification = {
  installed: false,
  ready: false,
  reason: 'runner missing',
};

function makeOps(
  verifyResult: WdaPreinstallVerification,
  prepareResult?: WdaPreinstallVerification,
) {
  const calls = { verify: 0, prepare: 0 };
  const ops: FreshProfileOps = {
    async verify() {
      calls.verify += 1;
      return verifyResult;
    },
    async prepare() {
      calls.prepare += 1;
      if (prepareResult) return prepareResult;
      throw new Error('prepare should not have been called');
    },
  };
  return { ops, calls };
}

const INPUT = {
  udid: '00008110-UDID',
  deviceId: 'CORE-DEVICE-ID',
  wdaBundleId: 'T.WebDriverAgentRunner',
  buildOpts: { projectPath: '/wda', udid: '00008110-UDID', teamId: 'UJ876FXT32' },
  confirmed: true,
};

describe('ensureFreshProfile', () => {
  it('skips the rebuild pipeline when the runner is already installed', async () => {
    const { ops, calls } = makeOps(INSTALLED);
    const result = await ensureFreshProfile(INPUT, ops);
    expect(result.refreshed).toBe(false);
    expect(result.verification.installed).toBe(true);
    expect(result.verification.ready).toBe(false);
    expect(calls.verify).toBe(1);
    expect(calls.prepare).toBe(0);
  });

  it('runs the rebuild pipeline when the runner is not installed', async () => {
    const { ops, calls } = makeOps(NOT_INSTALLED, INSTALLED);
    const result = await ensureFreshProfile(INPUT, ops);
    expect(result.refreshed).toBe(true);
    expect(result.verification.installed).toBe(true);
    expect(result.verification.ready).toBe(false);
    expect(calls.verify).toBe(1);
    expect(calls.prepare).toBe(1);
  });

  it('propagates the R7 confirmation error from prepare', async () => {
    const ops: FreshProfileOps = {
      async verify() {
        return NOT_INSTALLED;
      },
      async prepare() {
        throw new Error(
          'R7: Installing WDA to a physical device modifies the target device and requires user confirmation.',
        );
      },
    };
    expect(ensureFreshProfile({ ...INPUT, confirmed: false }, ops)).rejects.toThrow('R7');
  });
});
