/**
 * Appium process liveness — B13 module split (promotion guide §11.3
 * "device-appium"; B06 owned-process discipline).
 *
 * Probes whether a process is alive via signal(pid, 0); ESRCH means the
 * process is gone. The signal function is injected for testability.
 */

export type ProcessSignalFn = (pid: number, signal?: NodeJS.Signals | number) => boolean;

/** Returns true when the process is alive (signal 0 succeeds). */
export function isProcessAlive(pid: number, deps: { signal: ProcessSignalFn }): boolean {
  try {
    deps.signal(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}
