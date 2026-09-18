import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runOwnedMemorySession } from '../src/xcode-memory-owned-session.js';

const target = {
  deviceId: 'fixture',
  bundleId: 'fixture',
  buildReference: 'fixture',
  executable: '/fixture',
};
const output = (sessionId: string) => ({
  stdout: JSON.stringify({
    protocolVersion: 1,
    sessionId,
    scope: 'owned_app_only',
    reason: 'completed',
    cleanupVerified: true,
  }),
  stderr: '',
  exitCode: 0,
  interrupted: false,
});
test('App-only session releases a lease only after a bound result and helper exit', async () => {
  const helpersRoot = realpathSync(mkdtempSync('/private/tmp/itestagent-owned-lease-'));
  try {
    const result = await runOwnedMemorySession({ helpersRoot, target }, async (id) => output(id));
    expect(result).toEqual({ reason: 'completed', cleanupVerified: true, leaseRetained: false });
    expect(existsSync(join(helpersRoot, 'xcode-memory-session.lock'))).toBe(false);
  } finally {
    rmSync(helpersRoot, { recursive: true, force: true });
  }
});
for (const kind of ['killed', 'missing', 'stale', 'scope', 'unverified', 'rejected'] as const) {
  test(`App-only session retains the lease for ${kind} completion`, async () => {
    const helpersRoot = realpathSync(mkdtempSync('/private/tmp/itestagent-owned-lease-'));
    try {
      const result = await runOwnedMemorySession({ helpersRoot, target }, async (id) => {
        if (kind === 'rejected') throw new Error('fixture');
        const result = output(id);
        if (kind === 'killed') result.exitCode = 137;
        if (kind === 'missing') result.stdout = '';
        if (kind === 'stale') result.stdout = output('00000000-0000-4000-8000-000000000000').stdout;
        if (kind === 'scope') result.stdout = result.stdout.replace('owned_app_only', 'capture');
        if (kind === 'unverified') result.stdout = result.stdout.replace('true', 'false');
        return result;
      });
      expect(result).toEqual({
        reason: 'cleanup_unverified',
        cleanupVerified: false,
        leaseRetained: true,
      });
      expect(existsSync(join(helpersRoot, 'xcode-memory-session.lock'))).toBe(true);
      let started = false;
      await expect(
        runOwnedMemorySession({ helpersRoot, target }, async (id) => {
          started = true;
          return output(id);
        }),
      ).rejects.toThrow('session.instance_conflict');
      expect(started).toBe(false);
    } finally {
      rmSync(helpersRoot, { recursive: true, force: true });
    }
  });
}
test('pre-cancelled App-only session reserves no lease and starts no runner', async () => {
  const helpersRoot = realpathSync(mkdtempSync('/private/tmp/itestagent-owned-lease-'));
  try {
    const result = await runOwnedMemorySession(
      { helpersRoot, target, signal: AbortSignal.abort() },
      async () => {
        throw new Error('must not start');
      },
    );
    expect(result.reason).toBe('cancelled');
    expect(existsSync(join(helpersRoot, 'xcode-memory-session.lock'))).toBe(false);
  } finally {
    rmSync(helpersRoot, { recursive: true, force: true });
  }
});
