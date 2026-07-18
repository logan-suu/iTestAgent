/**
 * Doctor shared utilities — subprocess execution helpers.
 *
 * Shared by all doctor check modules to avoid duplication (PR #13 review W-1).
 */
export function exec(
  cmd: string,
  args: string[],
): { exitCode: number; stdout: string; stderr: string } {
  try {
    const result = Bun.spawnSync({ cmd: [cmd, ...args] });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  } catch {
    return { exitCode: -1, stdout: '', stderr: 'command not found' };
  }
}
