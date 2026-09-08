import { expect, test } from 'bun:test';

for (const renderer of ['opentui', 'ink', 'ansi']) {
  test(`${renderer}: real PTY arrows never become letter shortcuts or duplicate Enter`, async () => {
    const child = Bun.spawn(
      ['python3', 'tests/integration/phase6/helpers/review_arrow_pty.py', process.cwd(), renderer],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exit, stderr || stdout).toBe(0);
    const results = JSON.parse(stdout) as Array<{
      scenario: string;
      selected: boolean;
      cleanExit: boolean;
      events: unknown[];
    }>;
    expect(results).toHaveLength(3);
    for (const result of results) {
      const prefix = result.scenario.split('-')[0];
      const navigate = prefix === 'plan' ? 'plan_navigate_section' : `${prefix}_navigate`;
      expect(result.selected).toBe(true);
      expect(result.cleanExit).toBe(true);
      expect(result.events).toEqual([
        { type: navigate, direction: 'down' },
        { type: navigate, direction: 'up' },
        { type: `${prefix}_confirm` },
      ]);
    }
  }, 30_000);
}
