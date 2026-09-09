import { expect, test } from 'bun:test';

test('production TUI baseline preview, one-shot decisions and pending-exit cleanup in a real PTY', async () => {
  const child = Bun.spawn(
    ['python3', 'tests/integration/phase6/helpers/baseline_acceptance_pty.py', process.cwd()],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exit, stderr || stdout).toBe(0);
  const rows = JSON.parse(stdout) as Array<{
    decision: string;
    asks: number;
    success: boolean;
    disposed: boolean;
    preview: boolean;
    peak: number;
    growth: number;
  }>;
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row.asks).toBe(1);
    expect(row.preview).toBe(true);
    expect(row.disposed).toBe(true);
    expect(row.success).toBe(row.decision === 'allow');
    expect(row.peak).toBe(row.decision === 'allow' ? 30 : 50);
    expect(row.growth).toBe(row.decision === 'allow' ? 10 : 25);
  }
}, 60_000);
