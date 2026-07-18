/**
 * SubprocessController — spawn/kill/timeout/reap for external processes.
 *
 * ADR-010 § "Abort, timeout and child processes":
 *   TUI cancel → server command → AgentRuntime.abort → ToolDispatcher cancel
 *   → backend AbortSignal → child SIGTERM → grace timeout → SIGKILL if needed
 *   → release WDA ports/tunnels/files → RunStateMachine cancelled/failed
 *   → preserve partial evidence index
 *
 * Invariants:
 *   - abort is idempotent
 *   - no orphan child processes
 *   - no pending tools after session ends
 *   - generated evidence remains indexable
 *
 * Backends managed via SubprocessController:
 *   - Appium server (appium)
 *   - xcodebuild test/build/archive
 *   - xctrace recording
 *   - (future) mobile-mcp server
 */

import type { Subprocess } from 'bun';

// ─── Types ───────────────────────────────────────────────────

/** Signal names accepted by kill(). */
export type SignalName = 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP' | 'SIGQUIT';

/** Exit information for a completed process. */
export interface ExitInfo {
  /** Exit code (0 = success, non-zero = error). Present when process exits normally. */
  exitCode: number | null;
  /** Signal that killed the process. Present when terminated by signal. */
  signal?: string;
  /** Whether the process was killed by the grace-period SIGKILL fallback. */
  killedByGrace?: boolean;
}

/** Options for spawn(). */
export interface SubprocessOptions {
  /** Command-line arguments. Default: [] */
  args?: string[];
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /** Environment variables. Default: process.env */
  env?: Record<string, string>;
  /** Kill process after this many milliseconds. Default: no timeout */
  timeoutMs?: number;
  /**
   * AbortSignal — when aborted, kills the process.
   * Follows the ADR-010 abort chain: SIGTERM → graceMs → SIGKILL.
   */
  signal?: AbortSignal;
  /**
   * Grace period in ms between SIGTERM and SIGKILL.
   * Default: 5000 (5s). Only applies when kill is triggered by
   * timeout, AbortSignal, or manual kill().
   */
  graceMs?: number;
}

/** Handle to a spawned subprocess. */
export interface SubprocessHandle {
  /** OS process ID (undefined if spawn failed synchronously). */
  readonly pid: number | undefined;
  /** Promise that resolves when the process exits. */
  readonly exited: Promise<ExitInfo>;
  /**
   * Kill the process.
   * Sends SIGTERM first, then SIGKILL after graceMs.
   * Idempotent — calling multiple times or on an already-exited process is safe.
   */
  kill(signal?: SignalName): void;
  /** Whether the process is still alive. */
  isAlive(): boolean;
}

// ─── Constants ──────────────────────────────────────────────

/** Default grace period: 5 seconds. */
const DEFAULT_GRACE_MS = 5000;

// ─── Implementation ─────────────────────────────────────────

/**
 * Spawn a subprocess and return a handle for lifecycle management.
 *
 * Wraps Bun.spawn with:
 *   - Timeout-based auto-kill
 *   - AbortSignal integration (SIGTERM → graceMs → SIGKILL)
 *   - Grace period between SIGTERM and SIGKILL
 *   - Idempotent kill
 *
 * @example
 *   const proc = spawn('appium', ['--port', '4723'], { timeoutMs: 600_000 });
 *   const result = await proc.exited;
 */
export function spawn(
  command: string,
  args?: string[],
  options?: SubprocessOptions,
): SubprocessHandle {
  const resolvedArgs = args ?? [];
  const graceMs = options?.graceMs && options.graceMs > 0 ? options.graceMs : DEFAULT_GRACE_MS;

  let subprocess: Subprocess | undefined;
  let exited: Promise<ExitInfo>;
  let killed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let _pid: number | undefined;

  // ─── Spawn the child process ────────────────────────────

  try {
    subprocess = Bun.spawn([command, ...resolvedArgs], {
      cwd: options?.cwd ?? process.cwd(),
      env: options?.env ?? process.env,
      // stdin is not connected — subprocess cannot read from parent.
      stdin: null,
      // Capture stdout/stderr for backend output (caller can pipe if needed).
      stdout: 'pipe',
      stderr: 'pipe',
      onExit(_subprocess, exitCode, signalCode, _error) {
        // Bun's onExit callback — clean up timers.
        clearKillTimer();
        clearTimeoutTimer();
      },
    });

    _pid = subprocess.pid;
  } catch (err) {
    // Spawn failed synchronously (e.g., command not found).
    // Return a handle with an immediately-rejected exited promise.
    _pid = undefined;
    exited = Promise.reject(err);
    return {
      get pid() {
        return _pid;
      },
      exited,
      kill: () => {},
      isAlive: () => false,
    };
  }

  // ─── Build the exited promise ───────────────────────────

  /**
   * Internal kill implementation — sends SIGTERM, schedules SIGKILL.
   */
  const doKill = (trigger: string, forceSignal?: SignalName): void => {
    if (killed) return; // Idempotent.
    killed = true;

    clearTimeoutTimer();

    const proc = subprocess;
    if (!proc || proc.killed) {
      return;
    }

    const sendSignal = (sig: SignalName): void => {
      try {
        proc.kill(sig);
      } catch {
        // Process may already be dead — ignore.
      }
    };

    if (forceSignal === 'SIGKILL') {
      sendSignal('SIGKILL');
      return;
    }

    // Standard abort chain: SIGTERM → graceMs → SIGKILL.
    sendSignal('SIGTERM');

    killTimer = setTimeout(() => {
      try {
        // Only send SIGKILL if process is still alive after grace period.
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
        }
      } catch {
        // Already dead.
      }
      killTimer = undefined;
    }, graceMs);
  };

  const clearKillTimer = (): void => {
    if (killTimer !== undefined) {
      clearTimeout(killTimer);
      killTimer = undefined;
    }
  };

  const clearTimeoutTimer = (): void => {
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
  };

  // ─── Build exited promise from Bun's Subprocess.exited ──

  // Bun's Subprocess.exited resolves to a number:
  //   0           = normal exit code 0
  //   1-127       = non-zero exit code
  //   >=128       = killed by signal (exitCode = 128 + signal_number)
  //     e.g. 143 = 128 + 15 (SIGTERM), 137 = 128 + 9 (SIGKILL)
  if (subprocess) {
    exited = subprocess.exited.then((rawCode: number) => {
      clearKillTimer();
      clearTimeoutTimer();

      if (rawCode >= 128 || rawCode === null) {
        return {
          exitCode: null,
          signal: rawCode !== null ? String(rawCode - 128) : undefined,
        };
      }
      return {
        exitCode: rawCode,
        signal: undefined,
      };
    });
  } else {
    // Should never reach here — spawn failure is handled above.
    exited = Promise.resolve({ exitCode: null });
  }

  // ─── Timeout ────────────────────────────────────────────

  const timeoutMs = options?.timeoutMs;
  if (timeoutMs && timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      doKill('timeout');
    }, timeoutMs);
  }

  // ─── AbortSignal ────────────────────────────────────────

  const signal = options?.signal;
  if (signal) {
    if (signal.aborted) {
      // Signal already aborted — kill immediately.
      doKill('abort_signal');
    } else {
      signal.addEventListener('abort', () => doKill('abort_signal'), { once: true });
    }
  }

  // ─── Return handle ──────────────────────────────────────

  return {
    get pid() {
      return _pid;
    },

    exited,

    kill(signalName?: SignalName): void {
      doKill('manual_kill', signalName);
    },

    isAlive(): boolean {
      if (!subprocess) return false;
      return !subprocess.killed && !killed;
    },
  };
}
