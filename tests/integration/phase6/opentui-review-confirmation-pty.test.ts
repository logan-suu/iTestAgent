import { describe, expect, test } from 'bun:test';

describe('OpenTUI review confirmation in a real PTY', () => {
  test('dispatches Enter for candidate, device, and plan confirmation', async () => {
    const repo = process.cwd();
    const processHandle = Bun.spawn(
      ['python3', 'tests/integration/phase6/helpers/opentui_review_confirmation_pty.py', repo],
      { cwd: repo, stdout: 'pipe', stderr: 'pipe' },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
    ]);

    expect(exitCode, stderr || stdout).toBe(0);
    const results = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.selected).toBe(true);
      expect(result.firstFrame).toBe(true);
      expect(result.enterEvent).toBe(true);
      expect(result.cleanExit).toBe(true);
    }
  }, 15_000);
});
