/**
 * simctl-ops-process.test.ts — B12 app installation and process lifecycle
 * operations over `xcrun simctl` (promotion guide §11.3 "build-xcodebuild").
 *
 * Complements simctl-ops.test.ts (device state) with the install/launch/
 * terminate argument sequences used by the simulator execution lane.
 */
import { describe, expect, it } from 'bun:test';
import { createSimctlOps } from '../src/simctl-ops.js';
import type {
  XcodebuildProcessResult,
  XcodebuildProcessRunner,
} from '../src/xcodebuild-process-types.js';

function makeRecordingRunner(exitCode = 0): {
  runner: XcodebuildProcessRunner;
  calls: Array<{ cmd: string; args: string[] }>;
} {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const runner: XcodebuildProcessRunner = async (cmd, args) => {
    calls.push({ cmd, args });
    return { exitCode, stdout: '', stderr: '' };
  };
  return { runner, calls };
}

describe('simctl app/process operations', () => {
  it('installApp pins the exact argument sequence', async () => {
    const { runner, calls } = makeRecordingRunner();
    const ops = createSimctlOps(runner);
    await ops.installApp('SIM-FIXTURE-1', '/fixture/Fixture.app');
    expect(calls[0]?.cmd).toBe('xcrun');
    expect(calls[0]?.args).toEqual(['simctl', 'install', 'SIM-FIXTURE-1', '/fixture/Fixture.app']);
  });

  it('launchApp and terminateApp carry the bundle id', async () => {
    const { runner, calls } = makeRecordingRunner();
    const ops = createSimctlOps(runner);
    await ops.launchApp('SIM-FIXTURE-1', 'com.example.fixture');
    await ops.terminateApp('SIM-FIXTURE-1', 'com.example.fixture');
    expect(calls[0]?.args).toEqual(['simctl', 'launch', 'SIM-FIXTURE-1', 'com.example.fixture']);
    expect(calls[1]?.args).toEqual(['simctl', 'terminate', 'SIM-FIXTURE-1', 'com.example.fixture']);
  });

  it('propagates failure details when install exits non-zero', async () => {
    const { runner } = makeRecordingRunner(73);
    const ops = createSimctlOps(runner);
    await expect(ops.installApp('SIM-FIXTURE-BAD', '/fixture/Missing.app')).rejects.toThrow(
      /73|Missing\.app/,
    );
  });
});
