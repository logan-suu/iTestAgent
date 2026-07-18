/**
 * Doctor report terminal formatter.
 *
 * US-1.2 AC1: each item shows pass / fail / manual three-state.
 * US-1.2 AC2: fail items show fix guidance.
 * US-1.3 AC2: fix guidance includes step-by-step commands + phone-side instructions.
 * US-1.3 AC3: first-run time estimate.
 *
 * Output is plain text with ANSI color codes for terminal display.
 * No external dependencies — uses only Node.js process.stdout for color.
 */
import type { DoctorCheckResult, DoctorReport } from './types.js';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
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

/** Format full doctor report for terminal output. */
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
