/**
 * Command Line Tools check — doctor physical readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * Checks:
 *   1. xcode-select --print-path  → CLT or Xcode path
 *   2. xcrun --show-sdk-path       → SDK availability
 *   3. make / clang availability
 */
import type { DoctorCheckResult } from '../types.js';

/** Execute a command and return { exitCode, stdout, stderr }. */
function exec(cmd: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
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

export async function checkCommandLineTools(): Promise<DoctorCheckResult> {
  const clt = exec('xcode-select', ['--print-path']);
  const sdk = exec('xcrun', ['--show-sdk-path']);
  const clang = exec('clang', ['--version']);
  const details: string[] = [];
  const issues: string[] = [];

  if (clt.exitCode === 0 && clt.stdout) {
    details.push(`Developer path: ${clt.stdout}`);
  } else {
    issues.push('Command Line Tools path not found');
  }

  if (sdk.exitCode === 0 && sdk.stdout) {
    details.push(`SDK path: ${sdk.stdout}`);
  } else {
    issues.push('SDK not available (xcrun --show-sdk-path failed)');
  }

  if (clang.exitCode === 0) {
    const clangLine = clang.stdout.split('\n')[0] || clang.stdout;
    details.push(`clang: ${clangLine}`);
  } else {
    issues.push('clang not found');
  }

  if (issues.length === 0) {
    return {
      name: 'Command Line Tools',
      status: 'pass',
      message: 'Command Line Tools and SDK are available',
      details: details.join('\n'),
    };
  }

  return {
    name: 'Command Line Tools',
    status: 'fail',
    message: issues.join('; '),
    fixGuide: [
      'Install Command Line Tools: xcode-select --install',
      'Or: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
    ],
    details: details.join('\n'),
  };
}
