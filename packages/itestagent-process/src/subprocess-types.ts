/**
 * Subprocess types — shared contracts for process ownership.
 *
 * Moved verbatim from itestagent-server/src/subprocess-controller.ts (B06,
 * ADR-023): this is a move, not a rewrite.
 */

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
  /** What triggered the kill: 'timeout' | 'abort_signal' | 'manual_kill'. */
  trigger?: string;
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
