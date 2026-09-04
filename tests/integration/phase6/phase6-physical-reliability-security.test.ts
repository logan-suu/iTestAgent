import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

describe('Phase 6 reliability and security closure', () => {
  it('passes first frame, per-character input, resize, and clean exit on a real PTY for every renderer', async () => {
    const repo = resolve(import.meta.dir, '../../..');
    const process = Bun.spawn(
      ['python3', 'tests/integration/phase6/helpers/renderer_pty_matrix.py', repo],
      { cwd: repo, stdout: 'pipe', stderr: 'pipe' },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    const matrix = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(matrix).toHaveLength(3);
    for (const result of matrix) {
      expect(result).toMatchObject({
        selected: true,
        firstFrame: true,
        input: true,
        resize: true,
        cleanExit: true,
      });
    }
  }, 30_000);
});
