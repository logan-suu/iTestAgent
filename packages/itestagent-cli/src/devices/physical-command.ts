/**
 * Physical device CLI command wrapper — B18 module split (promotion guide
 * §11.3 "physical discovery/doctor").
 *
 * Thin, runner-injected wrapper around the pinned devicectl invocation.
 */

export interface DevicectlCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DevicectlCommandDeps {
  runner: (cmd: string, args: string[]) => Promise<DevicectlCommandResult>;
  /** Pinned binary path; defaults to `xcrun`. */
  binaryPath?: string;
}

export function createDevicectlCommand(deps: DevicectlCommandDeps): {
  listDevices(): Promise<string>;
} {
  const binary = deps.binaryPath ?? 'xcrun';
  return {
    async listDevices(): Promise<string> {
      const result = await deps.runner(binary, ['devicectl', 'list', 'devices']);
      if (result.exitCode !== 0) {
        throw new Error(`devicectl list devices failed (exit ${result.exitCode})`);
      }
      return result.stdout;
    },
  };
}
