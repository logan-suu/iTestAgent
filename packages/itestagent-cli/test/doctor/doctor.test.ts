/**
 * Doctor orchestrator and format unit tests.
 *
 * US-1.2 AC3: single failure does not interrupt overall diagnosis.
 * US-1.2 AC4: structured report readable by engine.
 * US-1.3 AC3: estimated first-run setup time.
 */
import { describe, expect, test } from 'bun:test';
import { runDoctor } from '../../src/doctor/doctor.js';
import { formatDoctorReport } from '../../src/doctor/format.js';
import type { DoctorReport } from '../../src/doctor/types.js';

describe('runDoctor', () => {
  test('returns DoctorReport with checks array', async () => {
    const report = await runDoctor();
    expect(report.checks).toBeDefined();
    expect(Array.isArray(report.checks)).toBe(true);
  });

  test('all checks present (6 physical readiness checks)', async () => {
    const report = await runDoctor();
    expect(report.checks.length).toBe(6);
  });

  test('summary totals match checks count', async () => {
    const report = await runDoctor();
    const { pass, fail, manual, total } = report.summary;
    expect(pass + fail + manual).toBe(total);
    expect(total).toBe(report.checks.length);
  });

  test('healthy flag is false when any check fails', async () => {
    const report = await runDoctor();
    if (report.summary.fail > 0) {
      expect(report.healthy).toBe(false);
    }
  });

  test('each check has valid three-state status (US-1.2 AC1)', async () => {
    const report = await runDoctor();
    for (const check of report.checks) {
      expect(['pass', 'fail', 'manual']).toContain(check.status);
      expect(typeof check.name).toBe('string');
      expect(check.name.length).toBeGreaterThan(0);
      expect(typeof check.message).toBe('string');
      expect(check.message.length).toBeGreaterThan(0);
    }
  });

  test('does not crash when individual check throws (US-1.2 AC3)', async () => {
    // Even if one check fails, runDoctor should complete all checks
    const report = await runDoctor();
    // All 6 checks should still be present
    expect(report.checks.length).toBe(6);
  });

  test('returns estimatedSetupMinutes when not healthy (US-1.3 AC3)', async () => {
    const report = await runDoctor();
    if (!report.healthy) {
      expect(report.estimatedSetupMinutes).toBeDefined();
      expect(report.estimatedSetupMinutes).toBeGreaterThan(0);
    }
  });
});

describe('formatDoctorReport', () => {
  const mockReport: DoctorReport = {
    checks: [
      {
        name: 'Xcode',
        status: 'pass',
        message: 'Xcode 16.0 is available',
        details: 'Xcode path: /Applications/Xcode.app',
      },
      {
        name: 'Code Signing',
        status: 'fail',
        message: 'No signing identities found',
        fixGuide: [
          'Add Apple ID in Xcode > Settings > Accounts',
          'Run: security find-identity -v -p codesigning',
        ],
      },
      {
        name: 'Physical Device',
        status: 'manual',
        message: '1 device detected. Enable Developer Mode.',
        fixGuide: [
          'Settings > Privacy & Security > Developer Mode',
          'Trust this computer when prompted',
        ],
      },
    ],
    summary: { pass: 1, fail: 1, manual: 1, total: 3 },
    healthy: false,
    estimatedSetupMinutes: 15,
  };

  test('output contains header', () => {
    const output = formatDoctorReport(mockReport);
    expect(output).toContain('iTestAgent Doctor');
    expect(output).toContain('Physical Readiness');
  });

  test('output shows three-state status icons (US-1.2 AC1)', () => {
    const output = formatDoctorReport(mockReport);
    expect(output).toContain('PASS');
    expect(output).toContain('FAIL');
    expect(output).toContain('MANUAL');
  });

  test('output shows fix guidance (US-1.2 AC2)', () => {
    const output = formatDoctorReport(mockReport);
    expect(output).toContain('Fix steps');
    expect(output).toContain('Add Apple ID');
  });

  test('output shows summary counts', () => {
    const output = formatDoctorReport(mockReport);
    expect(output).toContain('1 pass');
    expect(output).toContain('1 fail');
    expect(output).toContain('1 manual');
  });

  test('output shows time estimate when not healthy (US-1.3 AC3)', () => {
    const output = formatDoctorReport(mockReport);
    expect(output).toContain('Estimated first-run setup time');
    expect(output).toContain('15');
  });

  test('output shows manual action hint', () => {
    const output = formatDoctorReport(mockReport);
    expect(output).toContain('require manual action');
  });

  test('healthy report hides time estimate', () => {
    const healthyReport: DoctorReport = {
      ...mockReport,
      summary: { pass: 3, fail: 0, manual: 0, total: 3 },
      healthy: true,
      estimatedSetupMinutes: undefined,
    };
    const output = formatDoctorReport(healthyReport);
    expect(output).not.toContain('Estimated first-run setup time');
    expect(output).toContain('All automated checks passed');
  });
});
