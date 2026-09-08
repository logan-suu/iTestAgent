import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { STARTUP_LOGO, SUCCESS_LOGO } from '../../../packages/itestagent-tui/src/startup-brand.js';

interface ColoredSpan {
  text: string;
  foreground: number[];
}

interface CapturedReviewFrame {
  scenario: string;
  frame: string;
  frames?: string[];
  events?: Array<{ type: string; text?: string }>;
  successSpans?: ColoredSpan[];
  brandSpanFrames?: ColoredSpan[][];
}

type FrameScenario =
  | 'candidate-edit'
  | 'candidate-arrows'
  | 'device-arrows'
  | 'plan-arrows'
  | 'assertion-arrows'
  | 'candidate-review'
  | 'device-review'
  | 'device-switch'
  | 'device-scroll'
  | 'plan-review'
  | 'chat-activity'
  | 'report-complete'
  | 'success-resize'
  | 'success-long-report'
  | 'welcome-resize'
  | 'setup-welcome'
  | 'setup-disclosure'
  | 'success-negative'
  | 'permission-timeout'
  | 'chat-input-lifecycle';

async function captureScenario(scenario: FrameScenario): Promise<CapturedReviewFrame> {
  const processHandle = Bun.spawn(
    ['bun', 'tests/integration/phase6/helpers/opentui_review_frame_harness.tsx', scenario],
    { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  expect(exitCode, stderr || stdout).toBe(0);
  return JSON.parse(stdout) as CapturedReviewFrame;
}

async function captureFrame(scenario: FrameScenario): Promise<string> {
  return (await captureScenario(scenario)).frame;
}

function expectAdjacentRows(frame: string, first: string, second: string): void {
  const lines = frame.split('\n');
  const firstRow = lines.findIndex((line) => line.includes(first));
  const secondRow = lines.findIndex((line) => line.includes(second));
  expect(firstRow).toBeGreaterThan(-1);
  expect(secondRow).toBe(firstRow + 1);
}

function expectBlockRows(frame: string, artwork: readonly string[]): number {
  const lines = frame.split('\n');
  const firstRow = lines.findIndex((line) => line.includes(artwork[0]?.trimEnd() ?? ''));
  expect(artwork).toHaveLength(4);
  expect(firstRow).toBeGreaterThan(-1);
  for (const [index, row] of artwork.entries()) {
    expect(lines[firstRow + index]).toContain(row.trimEnd());
  }
  expect(frame).not.toContain('�');
  return firstRow;
}

function expectGreenBrand(spans: readonly ColoredSpan[]): void {
  expect(spans.length).toBeGreaterThan(0);
  for (const span of spans) {
    const [red = 255, green = 0, blue = 255] = span.foreground;
    expect(green).toBeGreaterThan(red);
    expect(green).toBeGreaterThan(blue);
  }
}

describe('OpenTUI review layout character frames', () => {
  test('candidate editing preserves native cursor movement and commits once', async () => {
    const captured = await captureScenario('candidate-edit');
    expect(captured.frames?.[1]).toContain('ValidatioXn');
    expect(captured.events?.filter((event) => event.type === 'candidate_edit_commit')).toHaveLength(
      1,
    );
    expect(captured.events?.some((event) => event.type === 'candidate_navigate')).toBe(false);
    expect(captured.events?.some((event) => event.type === 'candidate_confirm')).toBe(false);
  });
  for (const [scenario, selected, navigation, confirmation, count] of [
    ['candidate-arrows', '> [ ]', 'candidate_navigate', 'candidate_confirm', 19],
    ['device-arrows', '> Simulator iPhone 1', 'device_navigate', 'device_confirm', 1],
    ['plan-arrows', '> Device', 'plan_navigate_section', 'plan_confirm', 1],
    [
      'assertion-arrows',
      '> [agent] Assertion 20',
      'assertion_navigate',
      'exit_assertion_review',
      19,
    ],
  ] as const) {
    test(`${scenario}: native arrows update selection and Enter dispatches exactly once`, async () => {
      const captured = await captureScenario(scenario);
      expect(captured.frames?.[1]).toContain(selected);
      if (scenario === 'candidate-arrows') expect(captured.frames?.[1]).toContain('Candidate 20');
      expect(captured.events?.filter((event) => event.type === navigation)).toHaveLength(count);
      expect(captured.events?.filter((event) => event.type === confirmation)).toHaveLength(1);
      expect(captured.events).toHaveLength(count + 1);
    });
  }
  test('keeps fixed header and candidate review rows separate', async () => {
    const frame = await captureFrame('candidate-review');
    expectAdjacentRows(frame, 'Workspace: /tmp/renderer-pty-workspace', 'Device: [✓ connected]');
    expectAdjacentRows(
      frame,
      'Candidate Core Paths — Review & Confirm',
      '↑/↓ or j/k:nav Space:toggle e:edit A:all N:none Enter:confirm Esc/q:cancel',
    );
    expectAdjacentRows(frame, '1/1 confirmed', 'Cmd: ↑/↓/Space/Enter/Esc (j/k/e/A/N/q)');
  });

  test('keeps fixed header and TestPlan review rows separate', async () => {
    const frame = await captureFrame('plan-review');
    expectAdjacentRows(frame, 'Workspace: /tmp/renderer-pty-workspace', 'Device: [✓ connected]');
    expectAdjacentRows(
      frame,
      'TestPlan Review — Confirm, Modify or Cancel',
      '↑/↓ or j/k:nav m:modify Enter:start Esc/q:cancel',
    );
    expectAdjacentRows(frame, 'Section 1/7', 'Cmd: ↑/↓/Enter/Esc (j/k/m/q)');
  });

  test('shows readiness without exposing device identifiers on the selection page', async () => {
    const frame = await captureFrame('device-review');
    expectAdjacentRows(
      frame,
      'Device Selection — current plan: physical',
      '↑/↓ or j/k:nav Enter:select r:refresh Esc/q:cancel',
    );
    expect(frame).toContain('Paired iPhone');
    expect(frame).toContain('discovered (not connected)');
    expect(frame).toContain('USB iPhone');
    expect(frame).toContain('ready');
    expect(frame).not.toContain('offline-device');
    expect(frame).not.toContain('ready-device');
    expect(frame).toContain('simulator');
    expect(frame).toContain('Simulator iPhone 1');
    expectAdjacentRows(frame, '2/3', 'Cmd: ↑/↓/Enter/r/Esc (j/k/q)');
  });

  test('keeps explicit target-switch confirmation visible above the device list', async () => {
    const frame = await captureFrame('device-switch');
    expect(frame).toContain('Switch physical → simulator');
    expect(frame).toContain('y:confirm n:keep current plan');
    expect(frame).not.toContain('sim-private');
  });

  test('scrolls the selected simulator into view for a long inventory', async () => {
    const frame = await captureFrame('device-scroll');
    expect(frame).toContain('> Simulator iPhone 12');
    expect(frame).toContain('14/14');
  });

  test('renders one safe activity row without raw tool payloads or identifiers', async () => {
    const captured = await captureScenario('chat-activity');
    const frame = captured.frame;
    expectAdjacentRows(frame, 'Device: [target not selected]', 'Activity:');
    expect(frame).toContain('Refreshing devices…');
    expect(frame).toContain('正在检查已连接的真机。');
    expect(frame).not.toContain('tool-output');
    expect(frame).not.toContain('device-tool');
    expect(frame).not.toContain('udid');
    expect(captured.frames).toHaveLength(2);
    const activityRows = captured.frames?.map(
      (capturedFrame) =>
        capturedFrame
          .split('\n')
          .find((line) => line.includes('Activity:'))
          ?.trim() ?? '',
    );
    expect(activityRows?.[0]).not.toBe(activityRows?.[1]);
    expect(activityRows?.[1]).toContain('Refreshing devices…');
  });

  test('keeps the entire next value visible after submitting a long message', async () => {
    const captured = await captureScenario('chat-input-lifecycle');
    expect(captured.frame).toContain('> allow');
    expect(captured.events).toContainEqual({ type: 'input', text: 'allow' });
    expect(captured.events?.filter((event) => event.type === 'submit')).toHaveLength(2);
  });

  test('shows report and evidence paths after completion without stale activity', async () => {
    const captured = await captureScenario('report-complete');
    const running = captured.frames?.[0] ?? '';
    const complete = captured.frames?.[1] ?? '';
    const settled = captured.frames?.[2] ?? '';
    const runDirectory = '/tmp/真机 验收/itestagent/runs/run_report_6_12';
    expect(running).toContain('Activity:');
    expect(running).toContain('Saving the run report…');
    expect(captured.frames).toHaveLength(3);
    for (const frame of [complete, settled]) {
      const bannerRow = expectBlockRows(frame, SUCCESS_LOGO);
      expect(frame.split('\n')[bannerRow - 2]).toContain(
        'Execution completed. Run run_report_6_12 committed.',
      );
      expect(frame.split('\n')[bannerRow - 1]?.trim()).toBe('');
      expect(frame.split('\n')[bannerRow + SUCCESS_LOGO.length]?.trim()).toBe('');
      expect(frame).not.toContain('SUCCESS');
      expect(frame).toContain('Execution completed. Run run_report_6_12 committed.');
      expectAdjacentRows(
        frame,
        `Report directory: ${runDirectory}`,
        `Summary: ${runDirectory}/summary.md`,
      );
      expectAdjacentRows(
        frame,
        `Summary: ${runDirectory}/summary.md`,
        `Evidence directory: ${runDirectory}/artifacts`,
      );
      expect(frame).not.toContain('Activity:');
      expect(frame).not.toContain('Saving the run report…');
      expect(frame).toContain('Type here and press Enter');
    }
    for (const index of [1, 2]) {
      const spans = captured.brandSpanFrames?.[index] ?? [];
      expect(spans).toHaveLength(4);
      expectGreenBrand(spans);
    }
  });

  test('compacts SUCCESS on narrow or short resize and restores its green block banner', async () => {
    const captured = await captureScenario('success-resize');
    expect(captured.frames).toHaveLength(6);
    for (const index of [1, 2, 5]) {
      const frame = captured.frames?.[index] ?? '';
      const bannerRow = expectBlockRows(frame, SUCCESS_LOGO);
      expect(frame.split('\n')[bannerRow - 2]).toContain(
        'Execution completed. Run run_report_6_12 committed.',
      );
      expect(frame).not.toContain('SUCCESS');
      expect(frame).toContain('Summary: /tmp/真机 验收/itestagent/runs/run_report_6_12/summary.md');
      expect(frame).toContain('Type here and press Enter');
      expect(frame).not.toContain('Activity:');
      expectGreenBrand(captured.brandSpanFrames?.[index] ?? []);
    }
    for (const index of [3, 4]) {
      const frame = captured.frames?.[index] ?? '';
      expect(frame.match(/SUCCESS/gu)).toHaveLength(1);
      expect(frame).not.toMatch(/[█▀▄]/u);
      expect(frame.indexOf('Execution completed.')).toBeLessThan(frame.indexOf('SUCCESS'));
      expectAdjacentRows(frame, 'SUCCESS', 'Report directory:');
      expect(frame).toContain('Report directory:');
      expect(frame).toContain('Summary:');
      expect(frame).toContain('Evidence directory:');
      expect(frame).toContain('Type here and press Enter');
      expect(frame).not.toContain('Activity:');
      expectGreenBrand(captured.brandSpanFrames?.[index] ?? []);
    }
  });

  test('scrolls long report paths without shrinking SUCCESS because of transcript length', async () => {
    const captured = await captureScenario('success-long-report');
    const runDirectory = `/tmp/${'long-project-name-'.repeat(12)}/runs/run-example`;
    expect(captured.frames).toHaveLength(3);
    const tail = captured.frames?.[0] ?? '';
    expect(tail).not.toContain('SUCCESS');
    const top = captured.frames?.[1] ?? '';
    const bannerRow = expectBlockRows(top, SUCCESS_LOGO);
    expect(top.split('\n')[bannerRow - 2]).toContain('Execution completed.');
    expect(top).toContain('Previous system message.');
    const expanded = captured.frames?.[2] ?? '';
    expectBlockRows(expanded, SUCCESS_LOGO);
    expect(expanded).not.toContain('SUCCESS');
    for (const [index, frame] of (captured.frames ?? []).entries()) {
      if (index === 1) continue;
      const lines = frame.split('\n');
      const inputRow = lines.findIndex((line) => line.includes('Type here and press Enter'));
      const inputTopBorder = lines.findLastIndex(
        (line, row) => row < inputRow && /[╭┌]/u.test(line),
      );
      const reportRow = lines.findIndex((line) => line.includes('Report directory:'));
      const evidenceRow = lines.findIndex((line) => line.includes('Evidence directory:'));
      const finalArtifactRow = lines.findIndex(
        (line, row) => row >= evidenceRow && line.includes('/artifacts'),
      );
      if (index === 2) expect(frame).toContain('Previous system message.');
      expect(frame).not.toContain('Activity:');
      expect(reportRow).toBeGreaterThan(-1);
      expect(evidenceRow).toBeGreaterThan(reportRow);
      expect(finalArtifactRow).toBeGreaterThan(evidenceRow);
      expect(inputTopBorder).toBeGreaterThan(finalArtifactRow);
      expect(inputRow).toBeGreaterThan(inputTopBorder);
      const visibleReport = lines
        .slice(reportRow, inputTopBorder)
        .map((line) => line.slice(0, 98))
        .join('')
        .replace(/\s/gu, '');
      expect(visibleReport).toContain(`Reportdirectory:${runDirectory}`);
      expect(visibleReport).toContain(`Summary:${runDirectory}/summary.md`);
      expect(visibleReport).toContain(`Evidencedirectory:${runDirectory}/artifacts`);
      expectGreenBrand(captured.brandSpanFrames?.[index] ?? []);
    }
  });

  test('renders a large welcome logo, compacts on resize, and hides it after task input', async () => {
    const captured = await captureScenario('welcome-resize');
    expect(captured.frames).toHaveLength(4);
    for (const index of [0, 2]) {
      const frame = captured.frames?.[index] ?? '';
      const bannerRow = expectBlockRows(frame, STARTUP_LOGO);
      const topRow = frame.split('\n')[bannerRow] ?? '';
      const wordmarkStart = topRow.indexOf(STARTUP_LOGO[0] ?? '');
      expect(topRow.slice(wordmarkStart + 2, wordmarkStart + 7)).toBe('▀▀█▀▀');
      expect(topRow.slice(wordmarkStart + 23, wordmarkStart + 27)).toBe('█▀▀█');
      for (const offset of [8, 13, 28, 33, 38]) {
        expect(topRow.slice(wordmarkStart + offset, wordmarkStart + offset + 4)).toBe('    ');
      }
      expect(frame).not.toContain('iTestAgent');
      expect(frame).not.toContain('#');
      expect(frame).toContain('Type here and press Enter');
      const spans = captured.brandSpanFrames?.[index] ?? [];
      expect(spans).toHaveLength(4);
      for (const span of spans) {
        const [red = 255, green = 0, blue = 0] = span.foreground;
        expect(green).toBeGreaterThan(red);
        expect(blue).toBeGreaterThan(red);
      }
    }
    const compact = captured.frames?.[1] ?? '';
    expect(compact.match(/iTestAgent/gu)).toHaveLength(1);
    expect(compact).not.toMatch(/[█▀▄]/u);
    expect(compact).toContain('Type here and press Enter');
    const active = captured.frames?.[3] ?? '';
    expect(active).toContain('Working on the confirmed task');
    expect(active).not.toMatch(/[█▀▄]/u);
    expect(active).not.toContain('iTestAgent');
  });

  test('keeps first-run setup and input visible when the logo compacts', async () => {
    const captured = await captureScenario('setup-welcome');
    for (const index of [0, 2]) {
      const frame = captured.frames?.[index] ?? '';
      expectBlockRows(frame, STARTUP_LOGO);
      expect(frame).not.toContain('iTestAgent');
    }
    for (const frame of captured.frames ?? []) {
      expect(frame).toContain('First-Time Setup');
      expect(frame).toContain('API Base URL');
      expect(frame).toContain('Type here and press Enter');
    }
    expect(captured.frames?.[1]?.match(/iTestAgent/gu)).toHaveLength(1);
    expect(captured.frames?.[1]).not.toMatch(/[█▀▄]/u);
    const disclosure = await captureFrame('setup-disclosure');
    expect(disclosure).toContain('iTestAgent');
    expect(disclosure).not.toMatch(/[█▀▄]/u);
    expectAdjacentRows(
      disclosure,
      'First-Time Setup',
      'Configure your AI provider to get started.',
    );
    expect(disclosure).toContain('Keychain Confirmation');
    expect(disclosure).toContain('Type here and press Enter');
    expect(disclosure).toContain('Ctrl+C to exit setup');
  }, 15_000);

  test('does not color user words or non-passed outcomes as successful', async () => {
    const captured = await captureScenario('success-negative');
    expect(captured.successSpans).toHaveLength(5);
    expect(captured.frame).not.toMatch(/[█▀▄]/u);
    for (const span of captured.successSpans ?? []) {
      const [red = 0, green = 0, blue = 0] = span.foreground;
      expect(green > red && green > blue).toBe(false);
    }
  });

  test('renders the permission deadline and timeout without a false denial or stale activity', async () => {
    const captured = await captureScenario('permission-timeout');
    const waiting = captured.frames?.[0] ?? '';
    const stopped = captured.frames?.[1] ?? '';
    expect(waiting).toContain('Awaiting permission: prepare_wda');
    expect(waiting).toContain('press Enter');
    expect(waiting).toContain('120s');
    expect(waiting).toContain('WebDriverAgent');
    expect(waiting).not.toContain('private-device-fixture');
    expect(stopped).toContain('timed out without a response');
    expect(stopped).not.toContain('Permission deny.');
    expect(stopped).not.toContain('Activity:');
  });

  test('resolves the OpenTUI runtime version declared by the TUI package', async () => {
    const manifest = JSON.parse(await readFile('packages/itestagent-tui/package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const expectedVersion = manifest.dependencies['@opentui/solid'];
    if (!expectedVersion) {
      throw new Error('TUI package does not declare @opentui/solid');
    }
    const processHandle = Bun.spawn(
      ['bun', '-e', "import pkg from '@opentui/solid/package.json'; console.log(pkg.version)"],
      { cwd: 'packages/itestagent-tui', stdout: 'pipe', stderr: 'pipe' },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
    ]);

    expect(exitCode, stderr || stdout).toBe(0);
    expect(stdout.trim()).toBe(expectedVersion);
  });
});
