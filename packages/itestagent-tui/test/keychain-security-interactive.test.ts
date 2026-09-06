import { describe, expect, test } from 'bun:test';

describe('macOS security interactive stdin transport', () => {
  test.skipIf(process.platform !== 'darwin')(
    'consumes a command from piped stdin without echoing the command',
    async () => {
      const command = 'help add-generic-password\n';
      const process = Bun.spawn(['/usr/bin/security', '-i'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      process.stdin.write(command);
      process.stdin.end();

      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: add-generic-password');
      expect(stderr).toBe('');
      expect(`${stdout}${stderr}`).not.toContain(command.trim());
    },
  );
});
