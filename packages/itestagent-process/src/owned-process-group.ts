/**
 * Owned process group — per-process ownership composition.
 *
 * Owning a process group means: the leader identity is recorded at
 * acquisition, kills follow the ADR-010 abort chain
 * (SIGTERM → graceMs → SIGKILL), cleanup deadlines are armed for timeout,
 * an AbortSignal escalates to kill, and the exit is reaped into ExitInfo.
 * Kill is idempotent; no orphan child survives the owner.
 *
 * Composes the concern modules (system / identity / cleanup / reaping) and
 * preserves the behavior of the original spawn() body from
 * itestagent-server/src/subprocess-controller.ts verbatim (B06, ADR-023).
 */

import type { Subprocess } from 'bun';
import { type CleanupDeadlines, createCleanupDeadlines } from './owned-process-group-cleanup.js';
import { type ProcessGroupLeader, identifyGroupLeader } from './owned-process-group-identity.js';
import { reapOwnedProcess } from './owned-process-group-reaping.js';
import { sendSignal } from './owned-process-group-system.js';
import type { ExitInfo, SignalName, SubprocessHandle } from './subprocess-types.js';

/** Ownership parameters resolved by the controller before acquisition. */
export interface OwnershipOptions {
  /** Grace period in ms between SIGTERM and SIGKILL (already resolved to the default). */
  graceMs: number;
  /** Kill the process after this many milliseconds. Undefined/<=0 = no timeout. */
  timeoutMs?: number;
  /** AbortSignal — when aborted, kills the process (TERM → graceMs → KILL). */
  signal?: AbortSignal;
}

/** An owned process group: leader identity plus its lifecycle handle. */
export interface OwnedProcessGroup {
  /** Leader identity captured at ownership acquisition. */
  readonly leader: ProcessGroupLeader;
  /** Lifecycle handle for the owned process. */
  readonly handle: SubprocessHandle;
}

/**
 * Take ownership of a started child process and return its lifecycle handle.
 *
 * Preserves the original spawn() semantics exactly:
 *   - idempotent kill (first trigger wins),
 *   - TERM → graceMs → KILL escalation with killedByGrace marking,
 *   - timeout auto-kill ('timeout') and abort propagation ('abort_signal'),
 *   - manual kill ('manual_kill'),
 *   - exit reaped into a single shared ExitInfo record.
 */
export function ownSubprocess(
  subprocess: Subprocess,
  ownership: OwnershipOptions,
  deadlines: CleanupDeadlines = createCleanupDeadlines(),
): OwnedProcessGroup {
  const { graceMs, timeoutMs, signal } = ownership;

  const leader = identifyGroupLeader(subprocess.pid);

  let killed = false;
  const exitInfo: ExitInfo = { exitCode: null };

  /**
   * Internal kill implementation — sends SIGTERM, schedules SIGKILL.
   */
  const doKill = (trigger: string, forceSignal?: SignalName): void => {
    if (killed) return; // Idempotent.
    killed = true;
    exitInfo.trigger = trigger;

    deadlines.clearTimeoutTimer();

    const proc = subprocess;
    if (!proc || proc.killed) {
      return;
    }

    if (forceSignal === 'SIGKILL') {
      sendSignal(proc, 'SIGKILL');
      return;
    }

    // Standard abort chain: SIGTERM → graceMs → SIGKILL.
    sendSignal(proc, 'SIGTERM');

    deadlines.scheduleGraceKill(graceMs, () => {
      // Only send SIGKILL if process is still alive after grace period.
      if (!proc.killed) {
        exitInfo.killedByGrace = true;
        proc.kill('SIGKILL');
      }
    });
  };

  // ─── Reap the exit ──────────────────────────────────────

  const exited = reapOwnedProcess(subprocess, exitInfo, () => {
    deadlines.clearKillTimer();
    deadlines.clearTimeoutTimer();
  });

  // ─── Timeout ────────────────────────────────────────────

  if (timeoutMs && timeoutMs > 0) {
    deadlines.scheduleTimeoutKill(timeoutMs, () => {
      doKill('timeout');
    });
  }

  // ─── AbortSignal ────────────────────────────────────────

  if (signal) {
    if (signal.aborted) {
      // Signal already aborted — kill immediately.
      doKill('abort_signal');
    } else {
      signal.addEventListener('abort', () => doKill('abort_signal'), { once: true });
    }
  }

  return {
    leader,

    handle: {
      get pid() {
        return leader.pid;
      },

      exited,

      kill(signalName?: SignalName): void {
        doKill('manual_kill', signalName);
      },

      isAlive(): boolean {
        return !subprocess.killed && !killed;
      },
    },
  };
}
