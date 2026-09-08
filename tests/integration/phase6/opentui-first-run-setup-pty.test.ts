import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

describe('OpenTUI first-run setup real PTY', () => {
  it('accepts a Unicode secret without rendering it and exits cleanly', () => {
    const repo = resolve(import.meta.dir, '../../..');
    const processResult = Bun.spawnSync(
      ['python3', 'tests/integration/phase6/helpers/opentui_first_run_setup_pty.py', repo],
      { cwd: repo, stdout: 'pipe', stderr: 'pipe' },
    );
    const stdout = processResult.stdout.toString().trim();
    const stderr = processResult.stderr.toString().trim();

    expect(processResult.exitCode, stderr || stdout).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      selected: true,
      inputReceived: true,
      submitReceived: true,
      secretNotRendered: true,
      maskedFrameProduced: true,
      cleanExit: true,
    });
  }, 12_000);
});
