/**
 * Owned WDA process — B13 module split (promotion guide §11.3 "device-appium";
 * ADR-012 Route C: iTestAgent owns the WDA lifecycle; B06 owned-process
 * discipline).
 *
 * Thin handle over a self-managed WDA process: it is considered running from
 * creation until stop() tears it down via the injected kill. The handle never
 * guesses liveness from ambient state (R5).
 */

export interface OwnedWdaProcessDeps {
  /** Sends the stop signal to the WDA process (SIGTERM). */
  kill: (pid: number) => boolean;
}

export interface OwnedWdaProcess {
  pid: number;
  isRunning(): Promise<boolean>;
  stop(): Promise<void>;
}

/** Creates an owned WDA process handle for the given pid. */
export function createOwnedWdaProcess(pid: number, deps: OwnedWdaProcessDeps): OwnedWdaProcess {
  return {
    pid,
    async isRunning(): Promise<boolean> {
      // An owned process is running until stop() is called.
      return true;
    },
    async stop(): Promise<void> {
      deps.kill(pid);
    },
  };
}
