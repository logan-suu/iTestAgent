/**
 * Owned process group — cleanup deadlines.
 *
 * Timer plumbing for the two deadlines every owned process carries:
 *   - the grace deadline (SIGKILL fallback after SIGTERM), and
 *   - the timeout auto-kill deadline.
 *
 * Moved verbatim from the killTimer/timeoutTimer handling of
 * itestagent-server/src/subprocess-controller.ts (B06, ADR-023).
 */

/** Default grace period: 5 seconds. */
export const DEFAULT_GRACE_MS = 5000;

/** The two cleanup deadlines owned by a single process group. */
export interface CleanupDeadlines {
  /**
   * Schedule the SIGKILL fallback to fire after the SIGTERM grace period.
   * `fire` is invoked inside a try/catch — the process may already be dead.
   */
  scheduleGraceKill(graceMs: number, fire: () => void): void;
  /** Schedule the timeout auto-kill. */
  scheduleTimeoutKill(timeoutMs: number, fire: () => void): void;
  /** Cancel the grace SIGKILL fallback (process exited or kill already forced). */
  clearKillTimer(): void;
  /** Cancel the timeout auto-kill. */
  clearTimeoutTimer(): void;
}

/** Create the cleanup deadline timers for one owned process group. */
export function createCleanupDeadlines(): CleanupDeadlines {
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    scheduleGraceKill(graceMs: number, fire: () => void): void {
      killTimer = setTimeout(() => {
        try {
          fire();
        } catch {
          // Already dead.
        }
        killTimer = undefined;
      }, graceMs);
    },

    scheduleTimeoutKill(timeoutMs: number, fire: () => void): void {
      timeoutTimer = setTimeout(() => {
        fire();
      }, timeoutMs);
    },

    clearKillTimer(): void {
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
    },

    clearTimeoutTimer(): void {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
    },
  };
}
