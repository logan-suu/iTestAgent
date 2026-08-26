/**
 * Appium server process manager — B13 module split (promotion guide §11.3
 * "device-appium"; B06 owned-process discipline).
 *
 * Owns the Appium server process lifecycle: spawn via an injected runner,
 * and stop() sends SIGTERM through the injected kill so the owned process
 * group is torn down cleanly.
 */

export interface AppiumProcessHandle {
  pid: number;
  stop(): Promise<void>;
}

export interface AppiumProcessManagerDeps {
  /** Spawns the Appium server; returns the child pid. */
  spawn: (cmd: string, args: string[]) => Promise<{ pid: number }>;
  /** Sends a signal to a process (default stop signal: SIGTERM). */
  kill: (pid: number) => boolean;
}

export function createAppiumProcessManager(deps: AppiumProcessManagerDeps): {
  start(options: { port?: number }): Promise<AppiumProcessHandle>;
} {
  return {
    async start(options: { port?: number }): Promise<AppiumProcessHandle> {
      const port = options.port ?? 4723;
      const args = ['--port', String(port)];
      const { pid } = await deps.spawn('appium', args);
      return {
        pid,
        async stop(): Promise<void> {
          deps.kill(pid);
        },
      };
    },
  };
}
