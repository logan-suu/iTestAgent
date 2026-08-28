/**
 * owned-process-group.test.ts — ownership composition (guide §8.1, ADR-023).
 *
 * Behavior coverage for ownSubprocess(): leader identity capture, the
 * TERM→KILL escalation chain, trigger recording on ExitInfo, abort
 * propagation and liveness transitions. Uses real child processes — the
 * same style as the migrated subprocess-controller suite.
 */

import { describe, expect, test } from 'bun:test';
import { identifyGroupLeader } from '../src/owned-process-group-identity.js';
import { ownSubprocess } from '../src/owned-process-group.js';
import type { SubprocessHandle } from '../src/subprocess-types.js';

/** Python script that ignores SIGTERM so the grace SIGKILL path is exercised. */
const SIGTERM_IGNORE_SCRIPT =
  'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)';

/** Resolve after ms milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ensure a handle is cleaned up after each long-running use. */
function cleanup(handle: SubprocessHandle): void {
  try {
    if (handle.isAlive()) {
      handle.kill('SIGKILL');
    }
  } catch {
    // Process already exited.
  }
}

describe('ownSubprocess — leader identity', () => {
  test('captures the leader pid at acquisition and keeps it stable after exit', async () => {
    const child = Bun.spawn(['sleep', '0.05'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const group = ownSubprocess(child, { graceMs: 100 });

    expect(group.leader.pid).toBe(child.pid);
    expect(group.handle.pid).toBe(child.pid);

    await group.handle.exited;
    // Identity remains stable after the process exits.
    expect(group.leader.pid).toBe(child.pid);
    expect(group.handle.pid).toBe(child.pid);
  });

  test('identifyGroupLeader preserves an undefined pid (failed spawn shape)', () => {
    const leader = identifyGroupLeader(undefined);
    expect(leader.pid).toBeUndefined();
  });

  test('identifyGroupLeader records a numeric pid', () => {
    const leader = identifyGroupLeader(4242);
    expect(leader.pid).toBe(4242);
  });
});

describe('ownSubprocess — natural exit reaping', () => {
  test('natural exit decodes exitCode without a kill trigger', async () => {
    const child = Bun.spawn(['sh', '-c', 'exit 7'], {
      stdin: null,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const { handle } = ownSubprocess(child, { graceMs: 100 });

    const info = await handle.exited;
    expect(info.exitCode).toBe(7);
    expect(info.signal).toBeUndefined();
    expect(info.trigger).toBeUndefined();
    expect(info.killedByGrace).toBeUndefined();
    expect(handle.isAlive()).toBe(false);
  });
});

describe('ownSubprocess — TERM→KILL escalation', () => {
  test('manual kill marks the trigger and the grace fallback sets killedByGrace', async () => {
    const child = Bun.spawn(['python3', '-c', SIGTERM_IGNORE_SCRIPT], {
      stdin: null,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const { handle } = ownSubprocess(child, { graceMs: 100 });
    expect(handle.isAlive()).toBe(true);

    // Let the interpreter install its SIGTERM handler before killing.
    await sleep(300);

    handle.kill('SIGTERM');
    const info = await handle.exited;

    expect(info.trigger).toBe('manual_kill');
    // Python ignores SIGTERM — only the grace SIGKILL can stop it.
    expect(info.killedByGrace).toBe(true);
    expect(info.signal).toBeDefined();
    expect(handle.isAlive()).toBe(false);
  }, 5000);

  test('forced SIGKILL bypasses the grace period', async () => {
    const child = Bun.spawn(['python3', '-c', SIGTERM_IGNORE_SCRIPT], {
      stdin: null,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const { handle } = ownSubprocess(child, { graceMs: 5000 });

    handle.kill('SIGKILL');
    const info = await handle.exited;

    expect(info.trigger).toBe('manual_kill');
    expect(info.killedByGrace).toBeUndefined();
    expect(info.signal).toBeDefined();
  }, 5000);
});

describe('ownSubprocess — timeout deadline', () => {
  test('timeout auto-kill records the timeout trigger', async () => {
    const child = Bun.spawn(['sleep', '10'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, timeoutMs: 100 });

    const info = await handle.exited;
    expect(info.trigger).toBe('timeout');
    expect(info.signal).toBeDefined();
    expect(handle.isAlive()).toBe(false);
  }, 5000);

  test('zero timeoutMs arms no deadline — process exits naturally', async () => {
    const child = Bun.spawn(['sleep', '0.03'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, timeoutMs: 0 });

    const info = await handle.exited;
    expect(info.exitCode).toBe(0);
    expect(info.trigger).toBeUndefined();
  });
});

describe('ownSubprocess — abort propagation', () => {
  test('aborting the signal kills the process and records the abort trigger', async () => {
    const controller = new AbortController();
    const child = Bun.spawn(['sleep', '20'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, signal: controller.signal });

    setTimeout(() => controller.abort(), 50);

    const info = await handle.exited;
    expect(info.trigger).toBe('abort_signal');
    expect(info.signal).toBeDefined();
    expect(handle.isAlive()).toBe(false);
  }, 5000);

  test('pre-aborted signal kills immediately during acquisition', async () => {
    const controller = new AbortController();
    controller.abort();

    const child = Bun.spawn(['sleep', '10'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, signal: controller.signal });

    const info = await handle.exited;
    expect(info.trigger).toBe('abort_signal');
    expect(info.signal).toBeDefined();
  }, 5000);

  test('liveness transitions true → false across the abort kill', async () => {
    const controller = new AbortController();
    const child = Bun.spawn(['sleep', '20'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, signal: controller.signal });

    expect(handle.isAlive()).toBe(true);
    controller.abort();
    await handle.exited;
    expect(handle.isAlive()).toBe(false);

    cleanup(handle);
  }, 5000);
});
