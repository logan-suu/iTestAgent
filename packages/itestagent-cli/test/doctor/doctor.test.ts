/**
 * Doctor orchestrator and format unit tests — physical + simulator lanes.
 *
 * US-1.2 AC3: single failure does not interrupt overall diagnosis.
 * US-1.2 AC4: structured report readable by engine.
 * US-1.3 AC3: estimated first-run setup time.
 * 避坑手册 §3: simulator lane shown separately, signing/trust → N/A.
 */
import { describe, expect, test } from 'bun:test';
import { runDoctor, runPhysicalDoctor, runSimulatorDoctor } from '../../src/doctor/doctor.js';
import { formatDoctorReport, formatDualLaneReport } from '../../src/doctor/format.js';
import type { DoctorReport } from '../../src/doctor/types.js';

// ════════════════════════════════════════════════════════════
// runDoctor (combined)
// ════════════════════════════════════════════════════════════
describe('runDoctor', () => {
  test('returns DoctorReport with checks array', async () => {
    const report = await runDoctor();
    expect(report.checks).toBeDefined();
    expect(Array.isArray(report.checks)).toBe(true);
  });

  test('all checks present (6 physical + 5 simulator = 11)', async () => {
    const report = await runDoctor();
    expect(report.checks.length).toBe(11);
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
    const report = await runDoctor();
    // All 11 checks should still be present even if some fail
    expect(report.checks.length).toBe(11);
  });

  test('returns estimatedSetupMinutes when not healthy (US-1.3 AC3)', async () => {
    const report = await runDoctor();
    if (!report.healthy) {
      expect(report.estimatedSetupMinutes).toBeDefined();
      expect(report.estimatedSetupMinutes).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════════
// runPhysicalDoctor
// ════════════════════════════════════════════════════════════
describe('runPhysicalDoctor', () => {
  test('returns exactly 6 physical readiness checks', async () => {
    const report = await runPhysicalDoctor();
    expect(report.checks.length).toBe(6);
  });

  test('all checks have valid three-state status', async () => {
    const report = await runPhysicalDoctor();
    for (const check of report.checks) {
      expect(['pass', 'fail', 'manual']).toContain(check.status);
    }
  });
});

// ════════════════════════════════════════════════════════════
// runSimulatorDoctor
// ════════════════════════════════════════════════════════════
describe('runSimulatorDoctor', () => {
  test('returns exactly 5 simulator readiness checks', async () => {
    const report = await runSimulatorDoctor();
    expect(report.checks.length).toBe(5);
  });

  test('all checks have valid three-state status', async () => {
    const report = await runSimulatorDoctor();
    for (const check of report.checks) {
      expect(['pass', 'fail', 'manual']).toContain(check.status);
    }
  });
});

// ════════════════════════════════════════════════════════════
// formatDoctorReport (single-lane, backward compatible)
// ════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════
// formatDualLaneReport
// ════════════════════════════════════════════════════════════
describe('formatDualLaneReport', () => {
  const physicalReport: DoctorReport = {
    checks: [
      {
        name: 'Xcode',
        status: 'pass',
        message: 'Xcode 16.0 is available',
      },
    ],
    summary: { pass: 1, fail: 0, manual: 0, total: 1 },
    healthy: true,
  };

  const simulatorReport: DoctorReport = {
    checks: [
      {
        name: 'simctl',
        status: 'pass',
        message: 'simctl is available',
      },
      {
        name: 'Simulator Device',
        status: 'manual',
        message: '3 simulator device(s) available.',
      },
    ],
    summary: { pass: 1, fail: 0, manual: 1, total: 2 },
    healthy: true,
  };

  test('output contains both lane headers', () => {
    const output = formatDualLaneReport(physicalReport, simulatorReport);
    expect(output).toContain('Physical Readiness');
    expect(output).toContain('Simulator Readiness');
  });

  test('output shows N/A annotation for Simulator signing/trust', () => {
    const output = formatDualLaneReport(physicalReport, simulatorReport);
    expect(output).toContain('N/A for Simulator');
  });

  test('output shows per-lane summary counts', () => {
    const output = formatDualLaneReport(physicalReport, simulatorReport);
    expect(output).toContain('Physical:');
    expect(output).toContain('Simulator:');
  });

  test('output shows three-state icons', () => {
    const output = formatDualLaneReport(physicalReport, simulatorReport);
    expect(output).toContain('PASS');
    expect(output).toContain('MANUAL');
  });

  test('all healthy shows success message', () => {
    const output = formatDualLaneReport(physicalReport, simulatorReport);
    expect(output).toContain('All automated checks passed');
  });

  test('unhealthy shows time estimate', () => {
    const failPhysical: DoctorReport = {
      checks: [{ name: 'Xcode', status: 'fail', message: 'not found' }],
      summary: { pass: 0, fail: 1, manual: 0, total: 1 },
      healthy: false,
    };
    const failSimulator: DoctorReport = {
      checks: [{ name: 'simctl', status: 'fail', message: 'not found' }],
      summary: { pass: 0, fail: 1, manual: 0, total: 1 },
      healthy: false,
    };
    const output = formatDualLaneReport(failPhysical, failSimulator);
    expect(output).toContain('Estimated first-run setup time');
    expect(output).toContain('15-30 minutes');
  });

  test('manual items show action hint', () => {
    const output = formatDualLaneReport(physicalReport, simulatorReport);
    expect(output).toContain('require manual action');
  });
});
