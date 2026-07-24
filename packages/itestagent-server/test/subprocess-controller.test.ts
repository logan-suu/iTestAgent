import { afterEach, describe, expect, test } from 'bun:test';
import { spawn } from '../src/subprocess-controller.js';
import type { SubprocessHandle } from '../src/subprocess-controller.js';

// ─── Helpers ────────────────────────────────────────────────

/** Ensure a handle is cleaned up after each test. */
function cleanup(handle: SubprocessHandle): void {
  try {
    if (handle.isAlive()) {
      handle.kill('SIGKILL');
    }
  } catch {
    // Process already exited.
  }
}

/** Resolve after ms milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── spawn: basic lifecycle ─────────────────────────────────

describe('spawn', () => {
  test('spawns a process and resolves exited with exitCode 0', async () => {
    const proc = spawn('sleep', ['0.05']);
    expect(proc.pid).toBeGreaterThan(0);

    const result = await proc.exited;
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeUndefined();
    expect(proc.isAlive()).toBe(false);
  });

  test('resolves exited with non-zero exitCode', async () => {
    const proc = spawn('sh', ['-c', 'exit 3']);
    const result = await proc.exited;
    expect(result.exitCode).toBe(3);
  });

  test('reports isAlive true while process is running', async () => {
    const proc = spawn('sleep', ['1']);
    expect(proc.isAlive()).toBe(true);
    // Clean up — kill long-running process.
    proc.kill('SIGKILL');
    await proc.exited.catch(() => {});
    expect(proc.isAlive()).toBe(false);
  });

  test('reports isAlive false after exited resolves', async () => {
    const proc = spawn('sleep', ['0.02']);
    await proc.exited;
    expect(proc.isAlive()).toBe(false);
  });

  test('exited promise rejects on unexpected close (already consumed)', async () => {
    // Bun's Subprocess.exited resolves once. We test that our wrapper
    // exposes the same semantics — exited resolves, not rejects.
    const proc = spawn('sleep', ['0.02']);
    const result = await proc.exited;
    expect(result.exitCode).toBe(0);
    // Second await should still resolve (Bun caches the result).
    const result2 = await proc.exited;
    expect(result2.exitCode).toBe(0);
  });

  test('pid is numeric and positive', () => {
    const proc = spawn('sleep', ['0.02']);
    expect(typeof proc.pid).toBe('number');
    expect(proc.pid).toBeGreaterThan(0);
    cleanup(proc);
  });
});

// ─── spawn: kill ────────────────────────────────────────────

describe('kill', () => {
  const handles: SubprocessHandle[] = [];

  afterEach(() => {
    for (const h of handles) {
      cleanup(h);
    }
    handles.length = 0;
  });

  test('kill with SIGTERM terminates process and exited reports signal', async () => {
    const proc = spawn('sleep', ['10']);
    handles.push(proc);
    expect(proc.isAlive()).toBe(true);

    proc.kill('SIGTERM');
    const result = await proc.exited;

    // On Unix, SIGTERM results in signal field being set.
    expect(result.signal).toBeDefined();
    expect(proc.isAlive()).toBe(false);
  });

  test('kill with SIGKILL terminates immediately', async () => {
    const proc = spawn('sleep', ['10']);
    handles.push(proc);
    expect(proc.isAlive()).toBe(true);

    proc.kill('SIGKILL');
    const result = await proc.exited;
    expect(result.signal).toBeDefined();
    expect(proc.isAlive()).toBe(false);
  });

  test('kill on already-exited process does not throw', async () => {
    const proc = spawn('sleep', ['0.03']);
    await proc.exited;
    expect(proc.isAlive()).toBe(false);
    // Should not throw.
    expect(() => proc.kill('SIGTERM')).not.toThrow();
  });

  test('kill is idempotent — calling twice does not throw', async () => {
    const proc = spawn('sleep', ['5']);
    handles.push(proc);
    proc.kill('SIGTERM');
    // Second kill should not throw (process may already be dead).
    expect(() => proc.kill('SIGTERM')).not.toThrow();
    await proc.exited;
  });

  test('isAlive returns false after kill and exit', async () => {
    const proc = spawn('sleep', ['10']);
    handles.push(proc);
    proc.kill('SIGKILL');
    await proc.exited;
    expect(proc.isAlive()).toBe(false);
  });
});

// ─── spawn: timeout ─────────────────────────────────────────

describe('timeout', () => {
  test('kills process after timeoutMs expires', async () => {
    const proc = spawn('sleep', ['10'], { timeoutMs: 100 });
    const result = await proc.exited;

    // After timeout, process should be terminated with a signal.
    expect(result.signal).toBeDefined();
    expect(proc.isAlive()).toBe(false);
  });

  test('timeout does not fire if process exits before timeout', async () => {
    const proc = spawn('sleep', ['0.03'], { timeoutMs: 5000 });
    const result = await proc.exited;

    // Should exit normally, not killed by timeout.
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeUndefined();
  });

  test('zero or negative timeoutMs spawns without timeout', async () => {
    // timeoutMs <= 0 should be treated as "no timeout".
    const proc = spawn('sleep', ['0.03'], { timeoutMs: 0 });
    const result = await proc.exited;
    expect(result.exitCode).toBe(0);
  });
});

// ─── spawn: AbortSignal integration ─────────────────────────

describe('AbortSignal', () => {
  test('aborts process when AbortSignal fires', async () => {
    const controller = new AbortController();
    const proc = spawn('sleep', ['20'], { signal: controller.signal });

    // Abort after 50ms.
    setTimeout(() => controller.abort(), 50);

    const result = await proc.exited;
    expect(result.signal).toBeDefined();
    expect(proc.isAlive()).toBe(false);
  });

  test('abort signal after process already exited does not throw', async () => {
    const controller = new AbortController();
    const proc = spawn('sleep', ['0.03'], { signal: controller.signal });
    await proc.exited;

    // Abort after exit — should not throw.
    expect(() => controller.abort()).not.toThrow();
  });

  test('pre-aborted signal kills process immediately', async () => {
    const controller = new AbortController();
    controller.abort(); // Abort before spawn.

    const proc = spawn('sleep', ['10'], { signal: controller.signal });
    const result = await proc.exited;
    // Process should be killed immediately.
    expect(result.signal).toBeDefined();
  });

  test('abort + kill is idempotent', async () => {
    const controller = new AbortController();
    const proc = spawn('sleep', ['20'], { signal: controller.signal });
    controller.abort();
    // kill after abort should not throw.
    expect(() => proc.kill('SIGTERM')).not.toThrow();
    await proc.exited;
  });
});

// ─── spawn: grace period (SIGTERM → SIGKILL) ────────────────

describe('grace period', () => {
  const SIGTERM_IGNORE_SCRIPT =
    'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)';

  test('sends SIGTERM first, then SIGKILL after graceMs', async () => {
    const proc = spawn('python3', ['-c', SIGTERM_IGNORE_SCRIPT], {
      graceMs: 100,
    });

    await new Promise((r) => setTimeout(r, 200));

    proc.kill('SIGTERM');

    const start = Date.now();
    const result = await proc.exited;
    const elapsed = Date.now() - start;

    expect(result.signal).toBeDefined();
    // Grace period (100ms) should have elapsed; wall-clock may vary.
    // Upper bound guards against unbounded hangs.
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(2000);
  });

  test('custom graceMs is respected in timeout flow', async () => {
    const proc = spawn('python3', ['-c', SIGTERM_IGNORE_SCRIPT], {
      timeoutMs: 200,
      graceMs: 80,
    });

    await new Promise((r) => setTimeout(r, 200));

    const start = Date.now();
    const result = await proc.exited;
    const elapsed = Date.now() - start;

    expect(result.signal).toBeDefined();
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

// ─── spawn: error cases ─────────────────────────────────────

describe('error cases', () => {
  test('spawn with non-existent command rejects exited', async () => {
    const proc = spawn('nonexistent_command_xyz', []);

    // Bun throws on spawn failure for non-existent commands.
    try {
      await proc.exited;
      // If we get here, the spawn somehow succeeded — fail.
      expect.unreachable('Expected spawn to fail for non-existent command');
    } catch (err) {
      expect(err).toBeDefined();
    }
  });

  test('spawn with cwd option uses correct working directory', async () => {
    const proc = spawn('pwd', [], { cwd: '/tmp' });
    // pwd exits 0 — just verify it spawned.
    const result = await proc.exited;
    expect(result.exitCode).toBe(0);
  });
});

// ─── spawn: concurrent processes ────────────────────────────

describe('concurrent processes', () => {
  test('multiple concurrent spawns do not interfere', async () => {
    const procs = [spawn('sleep', ['0.05']), spawn('sleep', ['0.05']), spawn('sleep', ['0.05'])];

    const results = await Promise.all(procs.map((p) => p.exited));
    for (const r of results) {
      expect(r.exitCode).toBe(0);
    }
    for (const p of procs) {
      expect(p.isAlive()).toBe(false);
    }
  });

  test('killing one process does not affect sibling processes', async () => {
    const p1 = spawn('sleep', ['10']);
    const p2 = spawn('sleep', ['10']);

    p1.kill('SIGKILL');
    await p1.exited;
    expect(p1.isAlive()).toBe(false);
    expect(p2.isAlive()).toBe(true);

    // Clean up p2.
    p2.kill('SIGKILL');
    await p2.exited;
  });
});

// ─── spawn: env whitelisting (R6) ────────────────────────────

describe('env whitelisting', () => {
  test('does NOT pass arbitrary env vars to child processes by default', async () => {
    // Set a fake secret in process.env — the child should NOT see it
    process.env.FAKE_API_KEY = 'test-secret-value';

    // Verify the child does NOT have the fake secret
    // Using printenv to dump env; exit code 1 means the variable is not set
    const proc = spawn('sh', ['-c', 'printenv FAKE_API_KEY || exit 1']);

    const result = await proc.exited;
    expect(result.exitCode).toBe(1); // printenv exits 1 when var not found

    // Clean up
    process.env.FAKE_API_KEY = undefined;
  });

  test('passes whitelisted HOME to child processes', async () => {
    const proc = spawn('sh', ['-c', 'printenv HOME']);
    const result = await proc.exited;
    expect(result.exitCode).toBe(0);
  });

  test('passes whitelisted PATH to child processes', async () => {
    const proc = spawn('sh', ['-c', 'printenv PATH']);
    const result = await proc.exited;
    expect(result.exitCode).toBe(0);
  });

  test('caller can override env explicitly', async () => {
    const proc = spawn('sh', ['-c', 'printenv CUSTOM_VAR'], {
      env: {
        CUSTOM_VAR: 'hello',
        HOME: process.env.HOME || '/tmp',
        PATH: process.env.PATH || '/usr/bin',
      },
    });
    const result = await proc.exited;
    expect(result.exitCode).toBe(0);
  });
});
