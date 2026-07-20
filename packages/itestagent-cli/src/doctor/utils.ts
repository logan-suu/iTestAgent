/**
 * Doctor shared utilities — subprocess execution helpers.
 *
 * Shared by all doctor check modules to avoid duplication (PR #13 review W-1).
 *
 * exec() is swappable via setExecOverride() for test isolation.
 * In production, it uses Bun.spawnSync for real tool checks.
 */

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ExecFn = (cmd: string, args: string[]) => ExecResult;

function realExec(cmd: string, args: string[]): ExecResult {
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

let _exec: ExecFn = realExec;

/**
 * Override the exec implementation for testing.
 * Call with no arguments to restore the default.
 */
export function setExecOverride(fn?: ExecFn): void {
  _exec = fn ?? realExec;
}

export function exec(cmd: string, args: string[]): ExecResult {
  return _exec(cmd, args);
}
