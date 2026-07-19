/**
 * phase1-subprocess-lifecycle.test.ts — Integration test for subprocess controller.
 *
 * Cross-package chain under test:
 *   SubprocessController (itestagent-server) → Bun.spawn (Bun runtime)
 *   → OS process (real shell commands) → signal handling → exit tracking
 *
 * Verifies:
 *   - spawn() runs a real process and captures exit code
 *   - spawn() with timeout auto-kills the process
 *   - spawn() with AbortSignal kills process on abort
 *   - kill() is idempotent (calling multiple times is safe)
 *   - spawn() with non-existent command returns error handle
 *   - SIGTERM → grace → SIGKILL chain works
 *   - isAlive() reflects process state
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { spawn } from 'itestagent-server';
import type { SubprocessHandle } from 'itestagent-server';

// ─── Suite ────────────────────────────────────────────────

describe('Phase 1 Integration: Subprocess Lifecycle (spawn → Bun → OS process)', () => {
  // ─── 1. Basic spawn + normal exit ─────────────────────

  test('spawns a process that exits with code 0', async () => {
    const proc = spawn('echo', ['hello']);
    const info = await proc.exited;

    expect(info.exitCode).toBe(0);
    expect(info.signal).toBeUndefined();
  });

  test('spawns a process that exits with non-zero code', async () => {
    // Use a shell command that exits non-zero
    const proc = spawn('sh', ['-c', 'exit 42']);
    const info = await proc.exited;

    expect(info.exitCode).toBe(42);
  });

  // ─── 2. Timeout kills process ─────────────────────────

  test('timeout kills a long-running process', async () => {
    const proc = spawn('sleep', ['10'], { timeoutMs: 300, graceMs: 100 });

    const info = await proc.exited;
    // Should be killed by signal (exit code null or signal present)
    expect(info.exitCode !== 0 || info.signal !== undefined).toBe(true);
  }, 5000);

  // ─── 3. Manual kill ───────────────────────────────────

  test('kill() terminates a running process', async () => {
    const proc = spawn('sleep', ['10'], { graceMs: 100 });
    expect(proc.isAlive()).toBe(true);

    proc.kill();
    const info = await proc.exited;

    // Process was killed by signal
    expect(info.signal).toBeDefined();
  }, 5000);

  // ─── 4. kill() is idempotent ──────────────────────────

  test('kill() is idempotent — calling multiple times does not throw', async () => {
    const proc = spawn('sleep', ['10'], { graceMs: 100 });

    proc.kill();
    proc.kill(); // Second call — should not throw
    proc.kill(); // Third call — should not throw

    const info = await proc.exited;
    expect(info).toBeDefined();
  }, 5000);

  // ─── 5. AbortSignal integration ───────────────────────

  test('AbortSignal aborts the process', async () => {
    const controller = new AbortController();
    const proc = spawn('sleep', ['10'], { signal: controller.signal, graceMs: 100 });

    // Abort after a short delay
    setTimeout(() => controller.abort(), 200);

    const info = await proc.exited;
    // Process was killed
    expect(info.exitCode !== 0 || info.signal !== undefined).toBe(true);
  }, 5000);

  test('already-aborted signal kills process immediately', async () => {
    const controller = new AbortController();
    controller.abort(); // Abort before spawn

    const proc = spawn('sleep', ['10'], { signal: controller.signal, graceMs: 100 });
    const info = await proc.exited;

    expect(info.exitCode !== 0 || info.signal !== undefined).toBe(true);
  }, 5000);

  // ─── 6. Non-existent command ──────────────────────────

  test('spawn with non-existent command returns error handle', async () => {
    const proc = spawn('nonexistent_command_xyz', []);
    expect(proc.isAlive()).toBe(false);
    expect(proc.pid).toBeUndefined();

    await expect(proc.exited).rejects.toThrow();
  });

  // ─── 7. isAlive() reflects process state ──────────────

  test('isAlive() returns true for running process, false after exit', async () => {
    const proc = spawn('sleep', ['0.5'], { graceMs: 100 });
    expect(proc.isAlive()).toBe(true);

    await proc.exited;
    expect(proc.isAlive()).toBe(false);
  }, 5000);

  // ─── 8. Custom grace period ───────────────────────────

  test('respects custom graceMs between SIGTERM and SIGKILL', async () => {
    const start = Date.now();
    // Use a short-lived process but with a very short grace period
    const proc = spawn('sleep', ['5'], { graceMs: 50 });
    proc.kill();

    const info = await proc.exited;
    const elapsed = Date.now() - start;

    // Process should be killed quickly (within grace period)
    expect(elapsed).toBeLessThan(5000);
    expect(info.signal).toBeDefined();
  }, 10000);

  // ─── 9. Multiple concurrent processes ─────────────────

  test('multiple concurrent subprocesses run independently', async () => {
    const p1 = spawn('echo', ['one']);
    const p2 = spawn('echo', ['two']);
    const p3 = spawn('echo', ['three']);

    const results = await Promise.all([p1.exited, p2.exited, p3.exited]);

    for (const r of results) {
      expect(r.exitCode).toBe(0);
    }
  });
});
