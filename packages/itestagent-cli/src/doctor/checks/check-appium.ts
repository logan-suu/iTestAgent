/**
 * Appium availability check — doctor physical readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.2 AC2: fix guidance for failures.
 * US-1.3 AC1: recognizes "backend not ready" scenarios.
 *
 * Checks:
 *   1. appium --version    → Appium server installed?
 *   2. appium driver list --installed → XCUITest driver present?
 *
 * AGENTS.md §2 (R2): reuses Appium/WDA base, no self-built replacement.
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

export async function checkAppium(): Promise<DoctorCheckResult> {
  const version = exec('appium', ['--version']);
  const drivers = exec('appium', ['driver', 'list', '--installed']);
  const details: string[] = [];
  const issues: string[] = [];

  if (version.exitCode === 0 && version.stdout) {
    details.push(`Appium version: ${version.stdout}`);
  } else {
    issues.push(`Appium not found (${version.stderr || 'try: npm install -g appium'})`);
  }

  if (drivers.exitCode === 0) {
    const hasXCUITest = /xcuitest/i.test(drivers.stdout);
    details.push(`Installed drivers: ${hasXCUITest ? 'xcuitest ✓' : drivers.stdout || '(empty)'}`);
    if (!hasXCUITest) {
      issues.push('XCUITest driver not installed');
    }
  } else {
    issues.push(`Cannot query Appium drivers: ${drivers.stderr}`);
  }

  if (issues.length === 0) {
    return {
      name: 'Appium',
      status: 'pass',
      message: 'Appium server and XCUITest driver are installed',
      details: details.join('\n'),
    };
  }

  // If only driver missing but appium installed
  if (version.exitCode === 0 && issues.length > 0) {
    return {
      name: 'Appium',
      status: 'fail',
      message: issues.join('; '),
      fixGuide: [
        'Install XCUITest driver: appium driver install xcuitest',
        'Verify: appium driver list --installed',
      ],
      details: details.join('\n'),
    };
  }

  return {
    name: 'Appium',
    status: 'fail',
    message: issues.join('; '),
    fixGuide: [
      'Install Appium globally: npm install -g appium',
      'Install XCUITest driver: appium driver install xcuitest',
      'Verify: appium --version && appium driver list --installed',
    ],
    details: details.join('\n'),
  };
}
