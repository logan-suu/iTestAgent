import { expect, test } from 'bun:test';

test('PTY scenario exceptions preserve the error and clean child, descriptor, and event file', async () => {
  const child = Bun.spawn(['python3', 'tests/integration/phase6/helpers/pty_cleanup_test.py'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stderr || stdout).toBe(0);
  expect(stderr).toContain('OK');
});
