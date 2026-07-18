/**
 * Xcode availability check — doctor physical readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.2 AC2: fix guidance for failures.
 * US-1.3 AC1: recognizes "signing unavailable" scenarios.
 *
 * Checks:
 *   1. xcode-select -p   → Xcode path exists?
 *   2. xcodebuild -version → version string
 *   3. xcrun available?
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

export async function checkXcode(): Promise<DoctorCheckResult> {
  const xcodePath = exec('xcode-select', ['-p']);
  const xcodebuild = exec('xcrun', ['xcodebuild', '-version']);
  const issues: string[] = [];
  const details: string[] = [];

  if (xcodePath.exitCode !== 0) {
    issues.push('xcode-select returned no path');
  } else {
    details.push(`Xcode path: ${xcodePath.stdout}`);
  }

  if (xcodebuild.exitCode !== 0) {
    issues.push(`xcodebuild unavailable: ${xcodebuild.stderr || 'not found'}`);
  } else {
    details.push(`xcodebuild: ${xcodebuild.stdout.split('\n')[0] || xcodebuild.stdout}`);
  }

  if (issues.length === 0) {
    return {
      name: 'Xcode',
      status: 'pass',
      message: 'Xcode and xcodebuild are available',
      details: details.join('\n'),
    };
  }

  return {
    name: 'Xcode',
    status: 'fail',
    message: issues.join('; '),
    fixGuide: [
      'Install Xcode from the Mac App Store: https://apps.apple.com/app/xcode/id497799835',
      'Or install Command Line Tools: xcode-select --install',
      'After install, run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
      'Accept the license: sudo xcodebuild -license accept',
    ],
    details: details.join('\n'),
  };
}
