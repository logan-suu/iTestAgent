/**
 * Shared subprocess execution helper for devices module.
 *
 * Wraps Bun.spawnSync for running CLI tools (devicectl, simctl).
 * Used by discover.ts and healthcheck.ts to avoid duplication.
 */

export function exec(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const result = Bun.spawnSync({ cmd: args });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  } catch {
    return { exitCode: -1, stdout: '', stderr: 'command not found' };
  }
}
