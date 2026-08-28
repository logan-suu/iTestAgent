/**
 * owned-process-group-system.test.ts — system API adapters (guide §8.1, ADR-023).
 *
 * Behavior coverage for the OS-facing helpers: raw exit-code decoding,
 * safe environment construction (R6 secret whitelisting) and signal
 * delivery denial on dead processes. Env assertions use real child
 * processes, mirroring the migrated controller suite.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import {
  SAFE_ENV_KEYS,
  decodeRawExitCode,
  defaultEnv,
  sendSignal,
} from '../src/owned-process-group-system.js';

// ─── decodeRawExitCode ──────────────────────────────────────

describe('decodeRawExitCode', () => {
  test('decodes normal exit 0', () => {
    expect(decodeRawExitCode(0)).toEqual({ exitCode: 0, signal: undefined });
  });

  test('decodes non-zero exit codes unchanged', () => {
    expect(decodeRawExitCode(3)).toEqual({ exitCode: 3, signal: undefined });
    expect(decodeRawExitCode(42)).toEqual({ exitCode: 42, signal: undefined });
  });

  test('decodes signal deaths (>=128) into the signal number string', () => {
    // 143 = 128 + 15 (SIGTERM), 137 = 128 + 9 (SIGKILL)
    expect(decodeRawExitCode(143)).toEqual({ exitCode: null, signal: '15' });
    expect(decodeRawExitCode(137)).toEqual({ exitCode: null, signal: '9' });
  });

  test('handles a defensive null raw code', () => {
    expect(decodeRawExitCode(null)).toEqual({ exitCode: null, signal: undefined });
  });
});

// ─── defaultEnv / SAFE_ENV_KEYS (R6) ────────────────────────

describe('defaultEnv — R6 secret whitelisting', () => {
  const originalFakeKey = process.env.FAKE_API_KEY;
  const originalDebug = process.env.ITESTAGENT_DEBUG;

  afterAll(() => {
    if (originalFakeKey === undefined) process.env.FAKE_API_KEY = undefined;
    else process.env.FAKE_API_KEY = originalFakeKey;
    if (originalDebug === undefined) process.env.ITESTAGENT_DEBUG = undefined;
    else process.env.ITESTAGENT_DEBUG = originalDebug;
  });

  test('SAFE_ENV_KEYS covers the Xcode toolchain basics', () => {
    for (const key of ['HOME', 'PATH', 'DEVELOPER_DIR', 'TMPDIR']) {
      expect(SAFE_ENV_KEYS.has(key)).toBe(true);
    }
    // No credential-looking keys are whitelisted.
    expect(SAFE_ENV_KEYS.has('FAKE_API_KEY')).toBe(false);
  });

  test('inherits only whitelisted keys from process.env', () => {
    process.env.FAKE_API_KEY = 'test-secret-value';

    const env = defaultEnv();
    expect(env.HOME).toBeDefined();
    expect(env.PATH).toBeDefined();
    expect(env.FAKE_API_KEY).toBeUndefined();
  });

  test('passes ITESTAGENT_DEBUG through for diagnostics', () => {
    process.env.ITESTAGENT_DEBUG = '1';
    expect(defaultEnv().ITESTAGENT_DEBUG).toBe('1');
    process.env.ITESTAGENT_DEBUG = undefined;
    expect(defaultEnv().ITESTAGENT_DEBUG).toBeUndefined();
  });

  test('children spawned with default env do NOT see non-whitelisted secrets', async () => {
    process.env.FAKE_API_KEY = 'test-secret-value';
    try {
      const child = Bun.spawn(['sh', '-c', 'printenv FAKE_API_KEY || exit 1'], {
        env: defaultEnv(),
        stdin: null,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const code = await child.exited;
      // printenv exits 1 when the variable is not found.
      expect(code).toBe(1);
    } finally {
      process.env.FAKE_API_KEY = undefined;
    }
  });

  test('caller-provided explicit env overrides the whitelist entirely', async () => {
    const child = Bun.spawn(['sh', '-c', 'printenv CUSTOM_VAR'], {
      env: {
        CUSTOM_VAR: 'hello',
        HOME: process.env.HOME || '/tmp',
        PATH: process.env.PATH || '/usr/bin',
      },
      stdin: null,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('hello');
  });
});

// ─── sendSignal ─────────────────────────────────────────────

describe('sendSignal', () => {
  test('delivers SIGKILL to a live process', async () => {
    const child = Bun.spawn(['sleep', '10'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    expect(child.killed).toBe(false);

    sendSignal(child, 'SIGKILL');
    await child.exited;
    expect(child.killed).toBe(true);
  });

  test('signaling an already-exited process does not throw (delivery denied)', async () => {
    const child = Bun.spawn(['sleep', '0.02'], { stdin: null, stdout: 'pipe', stderr: 'pipe' });
    await child.exited;

    expect(() => sendSignal(child, 'SIGTERM')).not.toThrow();
    expect(() => sendSignal(child, 'SIGKILL')).not.toThrow();
  });
});
