import { expect, test } from 'bun:test';
import { STARTUP_LOGO, SUCCESS_LOGO } from '../../../packages/itestagent-tui/src/startup-brand.js';

function plain(frame: string): string {
  return Bun.stripANSI(frame);
}

test('Ink renders startup branding and a green canonical success heading without styling ordinary words', async () => {
  const child = Bun.spawn(
    ['bun', 'tests/integration/phase6/helpers/ink_branding_frame_harness.ts'],
    {
      env: { ...process.env, FORCE_COLOR: '3' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  const captured = JSON.parse(stdout) as {
    welcome: string;
    deviceReview: string;
    compactWelcome: string;
    passed: string;
    compactPassed: string;
    shortPassed: string;
    contentPressurePassed: string;
    untrusted: string;
    resizeListenerDelta: number;
  };
  expect(STARTUP_LOGO).toHaveLength(4);
  for (const row of STARTUP_LOGO) {
    expect(plain(captured.welcome)).toContain(row.trimEnd());
    expect(captured.welcome).toContain(`\x1b[38;2;139;213;202m${row.trimEnd()}`);
  }
  expect(captured.welcome).not.toContain('iTestAgent');
  expect(captured.welcome).toContain('v0.0.1');
  expect(captured.welcome).toContain('/tmp/project');
  expect(captured.compactWelcome).toContain('iTestAgent');
  expect(captured.compactWelcome).toContain('v0.0.1');
  expect(SUCCESS_LOGO).toHaveLength(4);
  for (const row of SUCCESS_LOGO) {
    expect(plain(captured.passed)).toContain(row.trimEnd());
    expect(captured.passed).toContain(`\x1b[32m${row.trimEnd()}`);
  }
  expect(captured.passed).toContain('/tmp/真机 验收/run/summary.md');
  expect(plain(captured.passed).indexOf('Execution completed.')).toBeLessThan(
    plain(captured.passed).indexOf(SUCCESS_LOGO[0]?.trimEnd() ?? ''),
  );
  expect(plain(captured.passed).indexOf(SUCCESS_LOGO[3]?.trimEnd() ?? '')).toBeLessThan(
    plain(captured.passed).indexOf('Report directory:'),
  );
  for (const compact of [
    captured.compactPassed,
    captured.shortPassed,
    captured.contentPressurePassed,
  ]) {
    expect(compact).toContain('\x1b[32mSUCCESS');
    expect(compact.indexOf('Execution completed.')).toBeLessThan(compact.indexOf('SUCCESS'));
    expect(compact.indexOf('SUCCESS')).toBeLessThan(compact.indexOf('Report directory:'));
    for (const row of SUCCESS_LOGO) expect(plain(compact)).not.toContain(row.trimEnd());
  }
  expect(captured.contentPressurePassed).toContain('Summary:');
  expect(captured.contentPressurePassed).toContain('Evidence directory:');
  expect(captured.untrusted).not.toContain('\x1b[32mSUCCESS');
  for (const row of SUCCESS_LOGO) expect(plain(captured.untrusted)).not.toContain(row.trimEnd());
  expect(captured.resizeListenerDelta).toBe(0);
  const devices = plain(captured.deviceReview);
  expect(devices).toContain('physical (current plan)');
  expect(devices).toContain('> Simulator iPhone');
  expect(devices).toContain('shutdown');
  expect(devices).toContain('Switch physical → simulator');
  expect(devices).toContain('y:confirm n:keep current plan');
  expect(devices).not.toContain('private-');
});
