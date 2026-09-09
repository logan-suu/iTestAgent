import { expect, test } from 'bun:test';

test('real TUI reviews confirmed memory rounds and executes with fresh per-round permission', async () => {
  const child = Bun.spawn(
    ['python3', 'tests/integration/phase6/helpers/memory_rounds_pty.py', process.cwd()],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exit, stderr || stdout).toBe(0);
  expect(JSON.parse(stdout)).toEqual({
    taps: 3,
    captures: 3,
    closed: 1,
    asks: 5,
    disposed: true,
    status: 'passed',
    rounds: ['passed', 'passed', 'passed'],
    baseline: 'skip',
    baselineFiles: 0,
  });
}, 60_000);

test('real TUI compiles Simulator native memory with baseline skip and reports a completed zero scan', async () => {
  const child = Bun.spawn(
    ['python3', 'tests/integration/phase6/helpers/memory_rounds_pty.py', process.cwd(), 'native'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exit, stderr || stdout).toBe(0);
  expect(JSON.parse(stdout)).toEqual({
    taps: 0,
    captures: 1,
    closed: 1,
    asks: 1,
    disposed: true,
    status: 'passed',
    connectionConfigured: true,
    scan: 'not_detected',
    baseline: 'skip',
    target: 'simulator',
  });
}, 60_000);
