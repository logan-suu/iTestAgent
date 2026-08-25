/**
 * Owned process group — system API adapters.
 *
 * Thin, honest wrappers over Bun/OS process facts used by the ownership
 * lifecycle: safe environment construction (R6), raw exit-code decoding,
 * and signal delivery. Moved from itestagent-server/src/subprocess-controller.ts
 * (B06, ADR-023); logic is verbatim where it existed.
 */

import type { Subprocess } from 'bun';
import type { SignalName } from './subprocess-types.js';

/**
 * Environment variables that are safe to pass to child processes.
 * Only whitelisted vars are inherited from process.env by default.
 *
 * R6: secrets (API keys, tokens, credentials) must NOT be passed
 * to child processes unless explicitly requested by the caller.
 */
export const SAFE_ENV_KEYS = new Set([
  'HOME',
  'PATH',
  'USER',
  'SHELL',
  'TMPDIR',
  'DEVELOPER_DIR', // Xcode toolchain
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'SSH_AUTH_SOCK',
]);

/**
 * Build a minimal environment for child processes.
 * Only whitelisted keys from process.env are inherited.
 * Callers that need full env (e.g., Appium server) must pass explicit `env` option.
 */
export function defaultEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) {
      env[key] = val;
    }
  }
  // Pass ITESTAGENT_DEBUG for diagnostics (no secret risk)
  if (process.env.ITESTAGENT_DEBUG) {
    env.ITESTAGENT_DEBUG = process.env.ITESTAGENT_DEBUG;
  }
  return env;
}

/**
 * Decode Bun's raw exit code into ExitInfo fields.
 *
 * Bun's Subprocess.exited resolves to a number:
 *   0           = normal exit code 0
 *   1-127       = non-zero exit code
 *   >=128       = killed by signal (exitCode = 128 + signal_number)
 *     e.g. 143 = 128 + 15 (SIGTERM), 137 = 128 + 9 (SIGKILL)
 */
export function decodeRawExitCode(rawCode: number | null): {
  exitCode: number | null;
  signal: string | undefined;
} {
  if (rawCode === null || rawCode >= 128) {
    return {
      exitCode: null,
      signal: rawCode !== null ? String(rawCode - 128) : undefined,
    };
  }
  return { exitCode: rawCode, signal: undefined };
}

/**
 * Deliver a signal to a child process.
 * The process may already be dead — denial of delivery (e.g. ESRCH) is
 * swallowed, matching the original inline implementation verbatim.
 */
export function sendSignal(proc: Subprocess, signal: SignalName): void {
  try {
    proc.kill(signal);
  } catch {
    // Process may already be dead — ignore.
  }
}
