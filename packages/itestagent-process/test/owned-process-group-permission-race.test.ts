/**
 * owned-process-group-permission-race.test.ts — signal delivery denial and
 * late-signal races (guide §8.1, ADR-023).
 *
 * The OS denies signal delivery to processes that no longer exist (ESRCH)
 * and the ownership layer must treat denial as a no-op: late kills, late
 * aborts and grace fallbacks firing against dead leaders must never throw
 * and never corrupt the already-reaped ExitInfo.
 */

import { describe, expect, test } from 'bun:test';
import { sendSignal } from '../src/owned-process-group-system.js';
import { ownSubprocess } from '../src/owned-process-group.js';
import type { SubprocessHandle } from '../src/subprocess-types.js';

function start(command: string[], graceMs = 100) {
  const child = Bun.spawn(command, { stdin: null, stdout: 'pipe', stderr: 'pipe' });
  return ownSubprocess(child, { graceMs });
}

/** Resolve after ms milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cleanup(handle: SubprocessHandle): void {
  try {
    if (handle.isAlive()) {
      handle.kill('SIGKILL');
    }
  } catch {
    // Process already exited.
  }
}

describe('signal permission — delivery denied on dead leaders', () => {
  test('raw sendSignal after exit resolves does not throw', async () => {
    const child = Bun.spawn(['sleep', '0.02'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    await child.exited;

    expect(() => sendSignal(child, 'SIGTERM')).not.toThrow();
    expect(() => sendSignal(child, 'SIGKILL')).not.toThrow();
  });

  test('handle.kill after the group was reaped does not throw', async () => {
    const { handle } = start(['sleep', '0.02']);
    const info = await handle.exited;
    expect(info.exitCode).toBe(0);

    expect(() => handle.kill('SIGTERM')).not.toThrow();
    expect(() => handle.kill('SIGKILL')).not.toThrow();

    // Re-awaiting the reaped exit returns the same record; the late kill
    // still records its trigger (first-trigger-wins semantics preserved
    // from the pre-move controller) but never unsets the exit result.
    const again = await handle.exited;
    expect(again.exitCode).toBe(0);
    expect(again.trigger).toBe('manual_kill');
    expect(again.signal).toBeUndefined();
  });

  test('late abort after natural exit does not throw', async () => {
    const controller = new AbortController();
    const child = Bun.spawn(['sleep', '0.02'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, signal: controller.signal });

    const info = await handle.exited;
    expect(info.exitCode).toBe(0);

    expect(() => controller.abort()).not.toThrow();
    const again = await handle.exited;
    expect(again.trigger).toBe('abort_signal');
    expect(again.exitCode).toBe(0);
  });
});

describe('permission race — grace fallback vs already-dead leader', () => {
  test('grace SIGKILL firing on a leader that ignored TERM marks killedByGrace exactly once', async () => {
    // Python ignores SIGTERM; only the grace fallback can stop it.
    const script =
      'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)';
    const child = Bun.spawn(['python3', '-c', script], {
      stdin: null,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const { handle } = ownSubprocess(child, { graceMs: 80 });

    // Let the interpreter install its SIGTERM handler before killing.
    await sleep(300);
    handle.kill('SIGTERM');
    const info = await handle.exited;

    expect(info.killedByGrace).toBe(true);
    expect(info.trigger).toBe('manual_kill');
    expect(handle.isAlive()).toBe(false);

    // Late signals against the now-dead leader are denied silently.
    expect(() => handle.kill('SIGKILL')).not.toThrow();
    const again = await handle.exited;
    expect(again.killedByGrace).toBe(true);
  }, 5000);

  test('forced SIGKILL path never reports killedByGrace', async () => {
    const child = Bun.spawn(['sleep', '20'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 5000 });

    handle.kill('SIGKILL');
    const info = await handle.exited;

    expect(info.trigger).toBe('manual_kill');
    expect(info.killedByGrace).toBeUndefined();
    expect(info.signal).toBeDefined();

    cleanup(handle);
  }, 5000);

  test('pre-aborted ownership denies later manual kills the trigger', async () => {
    const controller = new AbortController();
    controller.abort(); // Aborted before acquisition.

    const child = Bun.spawn(['sleep', '10'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    const { handle } = ownSubprocess(child, { graceMs: 50, signal: controller.signal });

    // The abort trigger fired during acquisition; a racing manual kill
    // must be denied the trigger (first trigger wins).
    expect(() => handle.kill('SIGKILL')).not.toThrow();

    const info = await handle.exited;
    expect(info.trigger).toBe('abort_signal');
    expect(info.signal).toBeDefined();
  }, 5000);
});
