/**
 * Subprocess spawn — low-level child start.
 *
 * Single responsibility: invoke Bun.spawn with the controller's fixed
 * process-group posture (no stdin, piped stdout/stderr, minimal env) and
 * surface the exit callback so the owner can release cleanup deadlines.
 * Throws synchronously when the command cannot be started; ownership of the
 * failure path stays with the caller (subprocess-controller.ts).
 *
 * Moved verbatim from itestagent-server/src/subprocess-controller.ts
 * (B06, ADR-023).
 */

import type { Subprocess } from 'bun';
import { defaultEnv } from './owned-process-group-system.js';
import type { SubprocessOptions } from './subprocess-types.js';

/** Callbacks the owner can attach to the raw spawn call. */
export interface StartSubprocessCallbacks {
  /**
   * Invoked from Bun's onExit when the child exits — the owner uses this to
   * release its cleanup deadlines (grace SIGKILL / timeout timers).
   */
  onExit?: () => void;
}

/**
 * Start a child process via Bun.spawn.
 * Throws when the command cannot be started (e.g., command not found).
 */
export function startSubprocess(
  command: string,
  args: string[],
  options: SubprocessOptions | undefined,
  callbacks: StartSubprocessCallbacks,
): Subprocess {
  return Bun.spawn([command, ...args], {
    cwd: options?.cwd ?? process.cwd(),
    env: options?.env ?? defaultEnv(),
    // stdin is not connected — subprocess cannot read from parent.
    stdin: null,
    // Capture stdout/stderr for backend output (caller can pipe if needed).
    stdout: 'pipe',
    stderr: 'pipe',
    onExit(_subprocess, _exitCode, _signalCode, _error) {
      // Bun's onExit callback — clean up timers.
      callbacks.onExit?.();
    },
  });
}
