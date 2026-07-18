/**
 * Doctor report terminal formatter — physical + simulator readiness lanes.
 *
 * US-1.2 AC1: each item shows pass / fail / manual three-state.
 * US-1.2 AC2: fail items show fix guidance.
 * US-1.3 AC2: fix guidance includes step-by-step commands + phone-side instructions.
 * US-1.3 AC3: first-run time estimate.
 *
 * 避坑手册 §3: simulator lane shown separately. Signing/Developer Mode/trust → N/A.
 *
 * Output is plain text with ANSI color codes for terminal display.
 * No external dependencies — uses only Node.js process.stdout for color.
 */
import type { DoctorCheckResult, DoctorReport } from './types.js';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/** Status icon strings. */
function statusIcon(status: DoctorCheckResult['status']): string {
  switch (status) {
    case 'pass':
      return `${GREEN}\u2713 PASS${RESET}`;
    case 'fail':
      return `${RED}\u2717 FAIL${RESET}`;
    case 'manual':
      return `${YELLOW}\u26A0 MANUAL${RESET}`;
  }
}

/** Format a single check result as terminal text. */
function formatCheck(check: DoctorCheckResult): string {
  const lines: string[] = [];
  lines.push(`  ${statusIcon(check.status)}  ${BOLD}${check.name}${RESET}`);
  lines.push(`    ${check.message}`);

  if (check.fixGuide && check.fixGuide.length > 0) {
    lines.push(`    ${YELLOW}Fix steps:${RESET}`);
    for (let i = 0; i < check.fixGuide.length; i++) {
      lines.push(`      ${i + 1}. ${check.fixGuide[i]}`);
    }
  }

  if (check.details) {
    lines.push(`    ${DIM}${check.details}${RESET}`);
  }

  return lines.join('\n');
}

/** Format a lane header with title. */
function formatLaneHeader(title: string, color: string): string {
  return `${color}${BOLD}${title}${RESET}`;
}

/** Format a section of checks with a header. */
function formatCheckSection(title: string, checks: DoctorCheckResult[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(formatLaneHeader(title, BLUE));
  lines.push('─'.repeat(50));
  lines.push('');

  for (const check of checks) {
    lines.push(formatCheck(check));
    lines.push('');
  }

  return lines.join('\n');
}

/** Format the combined summary line. */
function formatCombinedSummary(
  physicalChecks: DoctorCheckResult[],
  simulatorChecks: DoctorCheckResult[],
): string {
  const buildCounts = (cs: DoctorCheckResult[]) => ({
    pass: cs.filter((c) => c.status === 'pass').length,
    fail: cs.filter((c) => c.status === 'fail').length,
    manual: cs.filter((c) => c.status === 'manual').length,
  });

  const p = buildCounts(physicalChecks);
  const s = buildCounts(simulatorChecks);

  const lines: string[] = [];
  lines.push('─'.repeat(50));
  lines.push(`${BOLD}Results:${RESET}`);
  lines.push(
    `  Physical: ${GREEN}${p.pass} pass${RESET}, ${RED}${p.fail} fail${RESET}, ${YELLOW}${p.manual} manual${RESET} (${p.pass + p.fail + p.manual} total)`,
  );
  lines.push(
    `  Simulator: ${GREEN}${s.pass} pass${RESET}, ${RED}${s.fail} fail${RESET}, ${YELLOW}${s.manual} manual${RESET} (${s.pass + s.fail + s.manual} total)`,
  );

  const totalFail = p.fail + s.fail;
  if (totalFail === 0) {
    lines.push('');
    lines.push(`${GREEN}${BOLD}\u2713 All automated checks passed.${RESET}`);
  } else {
    lines.push('');
    lines.push(`${RED}${BOLD}\u2717 ${totalFail} check(s) failed. Review fix steps above.${RESET}`);
  }

  lines.push('');
  return lines.join('\n');
}

/** Format simulator-only report (unified format for backward compat). */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(`${BOLD}iTestAgent Doctor — Physical Readiness${RESET}`);
  lines.push('─'.repeat(50));
  lines.push('');

  // Individual checks
  for (const check of report.checks) {
    lines.push(formatCheck(check));
    lines.push('');
  }

  // Summary
  lines.push('─'.repeat(50));
  const { pass, fail, manual, total } = report.summary;
  const statusLine = [
    `${GREEN}${pass} pass${RESET}`,
    `${RED}${fail} fail${RESET}`,
    `${YELLOW}${manual} manual${RESET}`,
  ].join(', ');
  lines.push(`${BOLD}Results:${RESET} ${statusLine} (${total} total)`);
  lines.push('');

  // Health status
  if (report.healthy) {
    lines.push(`${GREEN}${BOLD}\u2713 All automated checks passed.${RESET}`);
  } else {
    lines.push(
      `${RED}${BOLD}\u2717 ${report.summary.fail} check(s) failed. Review fix steps above.${RESET}`,
    );
  }

  // First-run time estimate (US-1.3 AC3)
  if (report.estimatedSetupMinutes) {
    lines.push('');
    lines.push(
      `${YELLOW}\u2139 Estimated first-run setup time: ${report.estimatedSetupMinutes}-30 minutes.${RESET}`,
    );
    lines.push(`${DIM}  This includes WDA signing, device trust, and Appium verification.${RESET}`);
  }

  // Manual items action hint
  if (report.summary.manual > 0) {
    lines.push('');
    lines.push(
      `${YELLOW}\u26A0 ${report.summary.manual} item(s) require manual action. See fix steps above.${RESET}`,
    );
  }

  return lines.join('\n');
}

/**
 * Format dual-lane (physical + simulator) doctor report.
 * Displays both lanes with separate sections and per-lane N/A annotations.
 */
export function formatDualLaneReport(
  physicalReport: DoctorReport,
  simulatorReport: DoctorReport,
): string {
  const lines: string[] = [];

  // Overall header
  lines.push('');
  lines.push(`${BOLD}iTestAgent Doctor — Environment Readiness${RESET}`);
  lines.push('='.repeat(50));

  // Physical lane
  lines.push(formatCheckSection('Physical Readiness', physicalReport.checks));

  // Simulator lane + N/A annotations
  lines.push(formatCheckSection('Simulator Readiness', simulatorReport.checks));
  lines.push(`  ${DIM}Note: Signing / Developer Mode / Trust → N/A for Simulator.${RESET}`);
  lines.push(`  ${DIM}Simulator boot takes 30-60s. Verify by booting a device manually.${RESET}`);
  lines.push('');

  // Combined summary
  lines.push(formatCombinedSummary(physicalReport.checks, simulatorReport.checks));

  // Time estimate
  const totalFail = physicalReport.summary.fail + simulatorReport.summary.fail;
  if (totalFail > 0) {
    lines.push(`${YELLOW}\u2139 Estimated first-run setup time: 15-30 minutes.${RESET}`);
    lines.push(
      `${DIM}  Includes WDA setup, device trust, and Simulator/Appium verification.${RESET}`,
    );
  }

  // Manual items hint
  const totalManual = physicalReport.summary.manual + simulatorReport.summary.manual;
  if (totalManual > 0) {
    lines.push('');
    lines.push(
      `${YELLOW}\u26A0 ${totalManual} item(s) require manual action. See fix steps above.${RESET}`,
    );
  }

  return lines.join('\n');
}
