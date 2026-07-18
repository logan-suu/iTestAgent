import { checkAppium } from './checks/check-appium.js';
import { checkCommandLineTools } from './checks/check-clt.js';
import { checkPhysicalDevice } from './checks/check-device-physical.js';
import { checkSigning } from './checks/check-signing.js';
import { checkSimctl } from './checks/check-simctl.js';
import { checkSimulatorAppiumWda } from './checks/check-simulator-appium-wda.js';
import { checkSimulatorDevice } from './checks/check-simulator-device.js';
import { checkSimulatorRuntime } from './checks/check-simulator-runtime.js';
import { checkSimulatorSdk } from './checks/check-simulator-sdk.js';
import { checkWda } from './checks/check-wda.js';
import { checkXcode } from './checks/check-xcode.js';
/**
 * Doctor orchestrator — runs all readiness checks (physical + simulator).
 *
 * US-1.2 AC3: single check failure does not interrupt overall diagnosis.
 * US-1.2 AC4: structured DoctorReport readable by engine.
 * US-1.3 AC3: estimated first-run setup time (15-30 minutes).
 *
 * 避坑手册 §3: physical and simulator lanes displayed separately.
 * Simulator signing/Developer Mode/trust → N/A.
 *
 * AGENTS.md §4: components named itestagent-*, engine does not call subprocesses directly.
 * This module is CLI-level, not engine-level — results are human-facing first.
 */
import type { DoctorCheckResult, DoctorReport } from './types.js';

/** A check function that returns DoctorCheckResult. */
type CheckFn = () => Promise<DoctorCheckResult>;

/** Ordered list of physical readiness checks. */
const PHYSICAL_CHECKS: CheckFn[] = [
  checkXcode,
  checkCommandLineTools,
  checkAppium,
  checkWda,
  checkSigning,
  checkPhysicalDevice,
];

/** Ordered list of simulator readiness checks. */
const SIMULATOR_CHECKS: CheckFn[] = [
  checkSimctl,
  checkSimulatorRuntime,
  checkSimulatorSdk,
  checkSimulatorDevice,
  checkSimulatorAppiumWda,
];

/**
 * Run a list of check functions, collecting results.
 * Single check failure does NOT interrupt (US-1.2 AC3).
 */
async function runChecks(checkFns: CheckFn[]): Promise<DoctorCheckResult[]> {
  const checks: DoctorCheckResult[] = [];

  for (const checkFn of checkFns) {
    try {
      const result = await checkFn();
      checks.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push({
        name: checkFn.name || 'unknown',
        status: 'fail',
        message: `Check crashed: ${message}`,
        fixGuide: ['Re-run doctor. If persistent, check tool installation.'],
      });
    }
  }

  return checks;
}

/** Build summary stats from check results. */
function buildSummary(checks: DoctorCheckResult[]) {
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    manual: checks.filter((c) => c.status === 'manual').length,
    total: checks.length,
  };
}

/**
 * Run simulator readiness checks only.
 * Returns a standalone DoctorReport for the simulator lane.
 */
export async function runSimulatorDoctor(): Promise<DoctorReport> {
  const checks = await runChecks(SIMULATOR_CHECKS);
  const summary = buildSummary(checks);

  return {
    checks,
    summary,
    healthy: summary.fail === 0,
    estimatedSetupMinutes: summary.fail > 0 ? 15 : undefined,
  };
}

/**
 * Run all physical readiness checks (backward compatible with task 1.11).
 */
export async function runPhysicalDoctor(): Promise<DoctorReport> {
  const checks = await runChecks(PHYSICAL_CHECKS);
  const summary = buildSummary(checks);

  return {
    checks,
    summary,
    healthy: summary.fail === 0,
    estimatedSetupMinutes: summary.fail > 0 ? 15 : undefined,
  };
}

/**
 * Run all physical readiness checks.
 * Checks run sequentially. Single failure does NOT interrupt (US-1.2 AC3).
 *
 * Returns a structured DoctorReport for both CLI display and engine consumption (US-1.2 AC4).
 *
 * @deprecated Use runPhysicalDoctor() or runSimulatorDoctor() for lane-specific results,
 *             or runAllDoctor() for combined report.
 */
export async function runDoctor(): Promise<DoctorReport> {
  // Run both lanes sequentially, merge results
  const physicalChecks = await runChecks(PHYSICAL_CHECKS);
  const simulatorChecks = await runChecks(SIMULATOR_CHECKS);

  const allChecks = [...physicalChecks, ...simulatorChecks];
  const summary = buildSummary(allChecks);

  return {
    checks: allChecks,
    summary,
    healthy: summary.fail === 0,
    estimatedSetupMinutes: summary.fail > 0 ? 15 : undefined,
  };
}
