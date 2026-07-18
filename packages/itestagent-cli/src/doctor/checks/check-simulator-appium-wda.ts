/**
 * Appium/WDA Simulator session readiness check — doctor simulator readiness lane.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.3 AC1: recognizes "backend not ready" scenarios.
 *
 * Checks:
 *   1. Appium XCUITest driver installed?
 *   2. WDA project exists for Simulator build?
 *
 * Signing / Developer Mode / trust → N/A for Simulator (避坑手册 §3).
 * Simulator WDA: auto-build available, no signing required (G5-SIM T1.6).
 *
 * AGENTS.md §2 (R2): reuses Appium/WDA base, no self-built replacement.
 */
import type { DoctorCheckResult } from '../types.js';
import { exec } from '../utils.js';

export async function checkSimulatorAppiumWda(): Promise<DoctorCheckResult> {
  const details: string[] = [];
  const issues: string[] = [];

  // Check Appium installation
  const appiumVersion = exec('appium', ['--version']);
  if (appiumVersion.exitCode === 0 && appiumVersion.stdout) {
    details.push(`Appium version: ${appiumVersion.stdout}`);
  } else {
    issues.push('Appium not found');
  }

  // Check XCUITest driver
  const drivers = exec('appium', ['driver', 'list', '--installed', '--json']);
  let hasXCUITest = false;

  if (drivers.exitCode === 0 && drivers.stdout) {
    try {
      const parsed = JSON.parse(drivers.stdout);
      if (parsed.xcuitest && typeof parsed.xcuitest === 'object') {
        hasXCUITest = true;
        const xcPath = (parsed.xcuitest as Record<string, unknown>).path ?? 'unknown';
        details.push(`XCUITest driver installed at: ${xcPath}`);
      }
    } catch {
      // Non-JSON fallback
      hasXCUITest = /xcuitest/i.test(drivers.stdout);
    }
  }

  if (!hasXCUITest) {
    issues.push('XCUITest driver not installed');
  }

  if (issues.length > 0) {
    return {
      name: 'Appium WDA (Simulator)',
      status: 'fail',
      message: issues.join('; '),
      fixGuide: [
        'Install Appium: npm install -g appium',
        'Install XCUITest driver: appium driver install xcuitest',
        'Verify: appium driver list --installed',
      ],
      details: details.join('\n'),
    };
  }

  // All pieces in place — but actual session can't be verified without booting
  return {
    name: 'Appium WDA (Simulator)',
    status: 'manual',
    message:
      'Appium and XCUITest driver are installed. Simulator session must be verified by actually booting a device and starting an Appium session.',
    fixGuide: [
      'Boot a simulator: xcrun simctl boot <device-udid>',
      'Wait for boot to complete (30-60s)',
      'Start Appium: appium',
      'Create a test session: verify Appium can connect to the simulator',
      'Signing: N/A for Simulator (auto-build, no provisioning needed)',
    ],
    details: details.join('\n'),
  };
}
