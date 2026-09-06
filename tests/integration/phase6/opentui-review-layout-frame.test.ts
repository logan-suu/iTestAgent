import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

interface CapturedReviewFrame {
  scenario: string;
  frame: string;
}

async function captureFrame(scenario: 'candidate-review' | 'plan-review'): Promise<string> {
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
  return (JSON.parse(stdout) as CapturedReviewFrame).frame;
}

function expectAdjacentRows(frame: string, first: string, second: string): void {
  const lines = frame.split('\n');
  const firstRow = lines.findIndex((line) => line.includes(first));
  const secondRow = lines.findIndex((line) => line.includes(second));
  expect(firstRow).toBeGreaterThan(-1);
  expect(secondRow).toBe(firstRow + 1);
}

describe('OpenTUI review layout character frames', () => {
  test('keeps fixed header and candidate review rows separate', async () => {
    const frame = await captureFrame('candidate-review');
    expectAdjacentRows(frame, 'Workspace: /tmp/renderer-pty-workspace', 'Device: [✓ connected]');
    expectAdjacentRows(
      frame,
      'Candidate Core Paths — Review & Confirm',
      'j/k:nav space:toggle e:edit A:all N:none Enter:confirm q:cancel',
    );
    expectAdjacentRows(frame, '1/1 confirmed', 'Cmd: j/k/space/e/A/N/Enter/q');
  });

  test('keeps fixed header and TestPlan review rows separate', async () => {
    const frame = await captureFrame('plan-review');
    expectAdjacentRows(frame, 'Workspace: /tmp/renderer-pty-workspace', 'Device: [✓ connected]');
    expectAdjacentRows(
      frame,
      'TestPlan Review — Confirm, Modify or Cancel',
      'j/k:nav m:modify Enter:start q:cancel',
    );
    expectAdjacentRows(frame, 'Section 1/7', 'Cmd: j/k/m/Enter/q');
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
