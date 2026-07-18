import { checkAppium } from './checks/check-appium.js';
import { checkCommandLineTools } from './checks/check-clt.js';
import { checkPhysicalDevice } from './checks/check-device-physical.js';
import { checkSigning } from './checks/check-signing.js';
import { checkWda } from './checks/check-wda.js';
import { checkXcode } from './checks/check-xcode.js';
/**
 * Doctor orchestrator — runs all physical readiness checks.
 *
 * US-1.2 AC3: single check failure does not interrupt overall diagnosis.
 * US-1.2 AC4: structured DoctorReport readable by engine.
 * US-1.3 AC3: estimated first-run setup time (15-30 minutes).
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

/**
 * Run all physical readiness checks.
 * Checks run sequentially. Single failure does NOT interrupt (US-1.2 AC3).
 *
 * Returns a structured DoctorReport for both CLI display and engine consumption (US-1.2 AC4).
 */
export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheckResult[] = [];

  for (const checkFn of PHYSICAL_CHECKS) {
    // US-1.2 AC3: do not interrupt on single failure
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

  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    manual: checks.filter((c) => c.status === 'manual').length,
    total: checks.length,
  };

  const healthy = summary.fail === 0;

  return {
    checks,
    summary,
    healthy,
    // US-1.3 AC3
    estimatedSetupMinutes: healthy ? undefined : 15,
  };
}
