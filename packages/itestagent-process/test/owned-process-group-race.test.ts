/**
 * owned-process-group-race.test.ts — ownership races (guide §8.1, ADR-023).
 *
 * Race coverage for the owned lifecycle: timeout vs natural exit, grace
 * deadline vs self-terminating children, first-trigger-wins kill
 * idempotency, and independence of concurrent groups. Real child
 * processes, generous timing margins — same style as the migrated suite.
 */

import { describe, expect, test } from 'bun:test';
import { ownSubprocess } from '../src/owned-process-group.js';
import type { SubprocessHandle } from '../src/subprocess-types.js';

/** Python script that ignores SIGTERM and exits by itself after 2s. */
const SIGTERM_IGNORE_SELF_EXIT_SCRIPT =
  'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(2)';

/** Resolve after ms milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(command: string[], graceMs = 100) {
  const child = Bun.spawn(command, { stdin: null, stdout: 'pipe', stderr: 'pipe' });
  return ownSubprocess(child, { graceMs });
}

function cleanup(handle: SubprocessHandle): void {
  try {
    if (handle.isAlive()) {
      handle.kill('SIGKILL');
    }
  } catch {
    // Process already exited.
  }
}

describe('ownership race — deadline vs natural exit', () => {
  test('natural exit wins when the process finishes before the timeout', async () => {
    // Process exits at ~300ms; timeout would fire at 5000ms.
    const child = Bun.spawn(['sleep', '0.3'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 100, timeoutMs: 5000 });

    const info = await handle.exited;
    expect(info.exitCode).toBe(0);
    expect(info.trigger).toBeUndefined();
    expect(info.signal).toBeUndefined();
  }, 8000);

  test('self-terminating child wins over the grace SIGKILL fallback', async () => {
    // Child ignores SIGTERM and exits naturally at ~2s; grace is 5s,
    // so reaping must release the grace deadline before it ever fires.
    const child = Bun.spawn(['python3', '-c', SIGTERM_IGNORE_SELF_EXIT_SCRIPT], {
      stdin: null,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const { handle } = ownSubprocess(child, { graceMs: 5000 });

    // Let the interpreter install its SIGTERM handler before killing.
    await sleep(400);
    handle.kill('SIGTERM');
    const info = await handle.exited;

    expect(info.exitCode).toBe(0);
    expect(info.killedByGrace).toBeUndefined();
    expect(info.signal).toBeUndefined();
  }, 10000);

  test('timeout wins when the process outlives the deadline', async () => {
    const child = Bun.spawn(['sleep', '10'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, timeoutMs: 100 });

    const info = await handle.exited;
    expect(info.trigger).toBe('timeout');
    expect(info.signal).toBeDefined();
  }, 5000);
});

describe('ownership race — first trigger wins', () => {
  test('abort then manual kill keeps the abort trigger and does not throw', async () => {
    const controller = new AbortController();
    const child = Bun.spawn(['sleep', '20'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, signal: controller.signal });

    controller.abort();
    expect(() => handle.kill('SIGKILL')).not.toThrow();

    const info = await handle.exited;
    expect(info.trigger).toBe('abort_signal');
  }, 5000);

  test('manual kill then abort keeps the manual_kill trigger', async () => {
    const controller = new AbortController();
    const child = Bun.spawn(['sleep', '20'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, signal: controller.signal });

    handle.kill('SIGTERM');
    controller.abort(); // Late abort — owner already killed.

    const info = await handle.exited;
    expect(info.trigger).toBe('manual_kill');
  }, 5000);

  test('a burst of rapid kills is idempotent — exactly one trigger recorded', async () => {
    const child = Bun.spawn(['sleep', '20'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50 });

    for (let i = 0; i < 50; i++) {
      handle.kill('SIGTERM');
    }

    const info = await handle.exited;
    expect(info.trigger).toBe('manual_kill');
    expect(handle.isAlive()).toBe(false);
  }, 5000);
});

describe('ownership race — concurrent groups', () => {
  test('multiple concurrent groups exit independently', async () => {
    const groups = [start(['sleep', '0.05']), start(['sleep', '0.05']), start(['sleep', '0.05'])];

    const results = await Promise.all(groups.map((g) => g.handle.exited));
    for (const info of results) {
      expect(info.exitCode).toBe(0);
    }
    for (const g of groups) {
      expect(g.handle.isAlive()).toBe(false);
    }
  });

  test('killing one group does not affect its sibling', async () => {
    const g1 = start(['sleep', '10']);
    const g2 = start(['sleep', '10']);

    g1.handle.kill('SIGKILL');
    await g1.handle.exited;
    expect(g1.handle.isAlive()).toBe(false);
    expect(g2.handle.isAlive()).toBe(true);

    cleanup(g2.handle);
    await g2.handle.exited;
  }, 5000);

  test('each group carries its own leader identity', () => {
    const g1 = start(['sleep', '0.05']);
    const g2 = start(['sleep', '0.05']);

    expect(g1.leader.pid).not.toBe(g2.leader.pid);

    cleanup(g1.handle);
    cleanup(g2.handle);
  });
});
