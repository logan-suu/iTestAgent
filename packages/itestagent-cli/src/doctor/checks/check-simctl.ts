/**
 * simctl availability check — doctor simulator readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.2 AC2: fix guidance for failures.
 * US-1.3 AC1: recognizes "backend not ready" scenarios.
 *
 * Checks:
 *   1. xcrun simctl help → simctl CLI available?
 *
 * AGENTS.md §2 (R2): reuses xcrun simctl, no self-built simulator interaction.
 * 避坑手册 §3: simctl output format varies across Xcode versions — defensive parsing.
 */
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

export async function checkSimctl(): Promise<DoctorCheckResult> {
  const simctl = exec('xcrun', ['simctl', 'help']);

  if (simctl.exitCode === 0) {
    return {
      name: 'simctl',
      status: 'pass',
      message: 'simctl CLI is available',
      details: 'xcrun simctl help succeeded',
    };
  }

  return {
    name: 'simctl',
    status: 'fail',
    message: `simctl not available: ${simctl.stderr || 'command not found'}`,
    fixGuide: [
      'Install Xcode from the Mac App Store: https://apps.apple.com/app/xcode/id497799835',
      'Or install Command Line Tools: xcode-select --install',
      'After install: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
      'Verify: xcrun simctl help',
    ],
    details: simctl.stderr,
  };
}
