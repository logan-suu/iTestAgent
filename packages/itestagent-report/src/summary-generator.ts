import type { ReportSynthesizerInput } from './types.js';

/**
 * Generate a human-readable summary.md markdown string.
 *
 * B09 module split: report text sanitization lives in report-sanitizer;
 * replay outcomes are adapted via replay-to-report-adapter.
 *
 * AC3: summary.md must contain 结论 / 失败原因 / 关键指标 / 证据路径 / 下一步命令.
 */
export function generateSummary(input: ReportSynthesizerInput): string {
  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────
  lines.push(`# iTestAgent Run Report — ${input.runId}`, '');
  lines.push(`**Status**: ${statusLabel(input.status)}`);
  lines.push(`**Date**: ${new Date().toISOString()}`);
  lines.push(
    `**Device**: ${input.device.name} (${input.device.model}), iOS ${input.device.osVersion}`,
  );
  lines.push(`**Target**: ${input.environment.targetKind}`);
  lines.push(`**Comparison Scope**: ${input.environment.comparisonScope}`);
  lines.push('');

  // ── 结论 (Conclusion) ──────────────────────────────────
  lines.push('## 结论 (Conclusion)', '');
  lines.push(conclusionText(input));
  lines.push('');

  // ── 失败原因 (Failure Reason) ──────────────────────────
  if (input.status === 'failed' && input.explanation) {
    lines.push('## 失败原因 (Failure Reason)', '');
    lines.push(`**Type**: ${input.explanation.explanationType}`);
    lines.push(`**Summary**: ${input.explanation.summary}`);
    if (input.explanation.confidence) {
      lines.push(`**Confidence**: ${input.explanation.confidence}`);
    }
    if (input.explanation.suggestedActions && input.explanation.suggestedActions.length > 0) {
      lines.push('', '### Suggested Actions');
      for (const action of input.explanation.suggestedActions) {
        lines.push(`- ${action}`);
      }
    }
    lines.push('');
  }

  // ── 关键指标 (Key Metrics) ─────────────────────────────
  lines.push('## 关键指标 (Key Metrics)', '');
  lines.push(...metricsTable(input));
  lines.push('');

  // ── Baseline Delta ─────────────────────────────────────
  if (input.baselineDelta) {
    lines.push('## Baseline 对比', '');
    lines.push(`**Baseline**: ${input.baselineDelta.baselineId}`);
    lines.push(`**Overall**: ${input.baselineDelta.summary}`);
    lines.push('');

    const d = input.baselineDelta.deltas;
    lines.push('| Metric | Delta |');
    lines.push('|--------|-------|');
    if (d.launchDurationMs !== undefined) {
      lines.push(`| Launch Duration | ${formatDelta(d.launchDurationMs, 'ms')} |`);
    }
    if (d.memoryPeakMB !== undefined) {
      lines.push(`| Memory Peak | ${formatDelta(d.memoryPeakMB, 'MB')} |`);
    }
    if (d.hangCount !== undefined) {
      lines.push(`| Hang Count | ${formatDelta(d.hangCount, '')} |`);
    }
    if (d.hitches !== undefined) {
      lines.push(`| Hitches | ${d.hitches} |`);
    }
    if (d.fpsApproximate !== undefined) {
      lines.push(`| FPS (approx.) | ${formatDelta(-d.fpsApproximate, 'fps')} |`);
    }
    lines.push('');
  }

  // ── 证据路径 (Evidence Paths) ──────────────────────────
  lines.push('## 证据路径 (Evidence Paths)', '');
  if (input.allArtifacts.length > 0) {
    for (const artifact of input.allArtifacts) {
      const stepLabel = artifact.relatedStep ? ` (step: ${artifact.relatedStep})` : '';
      lines.push(`- **${artifact.type}**: \`${artifact.path}\`${stepLabel}`);
    }
  } else {
    lines.push('*No artifacts collected.*');
  }
  lines.push('');

  // ── 执行统计 ───────────────────────────────────────────
  lines.push('## 执行统计', '');
  const exec = input.execution;
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Steps | ${exec.totalSteps} |`);
  lines.push(`| Completed | ${exec.completedSteps} |`);
  lines.push(`| Failed | ${exec.failedSteps} |`);
  lines.push(`| Skipped | ${exec.skippedSteps} |`);
  lines.push(`| Duration | ${exec.durationMs}ms |`);
  lines.push(`| Backend | ${exec.backendUsed} |`);
  lines.push('');

  // ── 下一步命令 (Next Commands) ─────────────────────────
  lines.push('## 下一步命令 (Next Commands)', '');
  lines.push(...nextCommands(input));
  lines.push('');

  // ── R5 Notice ──────────────────────────────────────────
  if (input.metrics.approximate) {
    lines.push('> ⚠️ 部分指标为近似值（approximate），不代表精确测量结果。');
    lines.push('');
  }
  if (input.environment.targetKind === 'simulator') {
    lines.push(
      '> ⚠️ 此报告来自 iOS Simulator。性能数据不代表真实设备表现（comparisonScope=simulator_only）。',
    );
    lines.push('');
  }

  const summary = lines.join('\n');
  return sanitizeText(summary);
}

// ─── Private helpers ────────────────────────────────────────

/**
 * Sanitize credentials and secrets from report text (defense-in-depth for R6).
 * Applies regex redaction for common credential patterns before text hits disk.
 */
function sanitizeText(text: string): string {
  let result = text;
  // OpenAI API keys (sk-...)
  result = result.replace(/sk-[A-Za-z0-9_-]{32,}/gi, '[REDACTED]');
  // Standalone JWT tokens (must appear BEFORE the Bearer pattern to catch bare JWTs)
  result = result.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, '[REDACTED]');
  // JWT / Bearer tokens
  result = result.replace(
    /Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi,
    'Bearer [REDACTED]',
  );
  // Credential value assignments (password=, token=, secret=, apikey=, credential=)
  result = result.replace(
    /(password|token|secret|apikey|credential)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
    '$1=[REDACTED]',
  );
  // Auth header values (x-api-key:, authorization:)
  result = result.replace(/(x-api-key|authorization)\s*:\s*\S+/gi, '$1: [REDACTED]');
  return result;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    passed: '✅ Passed',
    failed: '❌ Failed',
    explored: '🔍 Explored',
    inconclusive: '❓ Inconclusive',
    needs_assertion: '⚠️ Needs Assertion',
    flaky: '🔄 Flaky',
    blocked: '🚫 Blocked',
  };
  return map[status] ?? status;
}

function conclusionText(input: ReportSynthesizerInput): string {
  switch (input.status) {
    case 'passed':
      return '所有测试用例通过，无需关注。';
    case 'failed':
      if (input.explanation) {
        return `测试失败：${input.explanation.summary}`;
      }
      return `测试失败。${input.execution.failedSteps} 个步骤失败。`;
    case 'explored':
      return `探索执行完成。${input.execution.completedSteps} 个步骤已执行，未设定断言（needs_assertion）。`;
    case 'inconclusive':
      return '结果不确定。证据不足以做出判断。';
    case 'needs_assertion':
      return '执行完成但缺少断言。需要添加断言后重新评估。';
    case 'flaky':
      return '结果不稳定（flaky），可能与历史结果不一致。';
    case 'blocked':
      return '执行被阻塞。可能是权限、设备或环境问题。';
    default:
      return `执行状态：${input.status}`;
  }
}

function metricsTable(input: ReportSynthesizerInput): string[] {
  const m = input.metrics;
  const rows: string[] = ['| Metric | Value |', '|--------|-------|'];

  if (m.launchDurationMs !== undefined) {
    rows.push(
      `| Launch Duration | ${m.launchDurationMs}ms${m.approximate ? ' (approximate)' : ''} |`,
    );
  }
  if (m.memoryPeakMB !== undefined) {
    rows.push(`| Memory Peak | ${m.memoryPeakMB} MB${m.approximate ? ' (approximate)' : ''} |`);
  }
  if (m.crashDetected !== undefined) {
    rows.push(`| Crash Detected | ${m.crashDetected ? 'Yes' : 'No'} |`);
  }
  if (m.hangCount !== undefined) {
    rows.push(`| Hang Count | ${m.hangCount}${m.approximate ? ' (approximate)' : ''} |`);
  }
  if (m.hitchesSummary !== undefined) {
    rows.push(`| Hitches | ${m.hitchesSummary}${m.approximate ? ' (approximate)' : ''} |`);
  }
  if (m.fpsApproximate !== undefined) {
    rows.push(
      `| FPS (approx.) | ${m.fpsApproximate.toFixed(1)}${m.approximate ? ' (approximate)' : ''} |`,
    );
  }

  if (rows.length === 2) {
    rows.push('| — | *No metrics collected* |');
  }

  return rows;
}

function nextCommands(input: ReportSynthesizerInput): string[] {
  const cmds: string[] = [];
  cmds.push(`- 查看详细结果：\`itestagent explain ${input.runId}\``);

  if (input.status === 'failed' || input.status === 'flaky') {
    cmds.push(`- 重跑失败用例：\`itestagent rerun ${input.runId} --failed-only\``);
  }

  if (input.status === 'needs_assertion') {
    cmds.push('- 添加断言后重新评估');
  }

  return cmds;
}

function formatDelta(value: number, unit: string): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value}${unit}`;
}
