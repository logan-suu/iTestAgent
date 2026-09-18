import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';

test.skipIf(process.platform !== 'darwin')(
  'parent loss becomes visible while main is blocked, with one main-thread cleanup',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-parent-lifetime-');
    try {
      const executable = join(root, 'lifetime');
      const compiled = await startCaptureProcess(
        [
          'xcrun',
          'swiftc',
          '-warnings-as-errors',
          '-module-cache-path',
          join(root, 'cache'),
          join(import.meta.dir, '../native/itestagent-memory-parent-lifetime.swift'),
          join(import.meta.dir, 'memory-parent-lifetime-fixture.swift'),
          '-o',
          executable,
        ],
        { timeoutMs: 60000 },
      ).completed;
      expect(compiled.exitCode, compiled.stderr).toBe(0);
      for (const mode of ['eof', 'bytes', 'SIGTERM', 'SIGINT', 'combined']) {
        const child = Bun.spawn([executable], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
        const errors = new Response(child.stderr).text();
        const reader = child.stdout.getReader();
        const first = await reader.read();
        let output = new TextDecoder().decode(first.value);
        expect(output.startsWith('ready\n')).toBe(true);
        if (mode === 'SIGTERM' || mode === 'SIGINT') child.kill(mode);
        else if (mode === 'bytes') {
          child.stdin.write('unexpected');
          await child.stdin.flush();
        } else {
          child.stdin.end();
          if (mode === 'combined') child.kill('SIGTERM');
        }
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          output += new TextDecoder().decode(part.value);
        }
        expect(await child.exited, await errors).toBe(0);
        const result = JSON.parse(output.slice(output.indexOf('\n') + 1));
        expect(result).toEqual({
          visibleBeforeMainDrain: true,
          callbacksBeforeMainDrain: 0,
          callbacks: 1,
          onMain: true,
          cancelledAfterStop: true,
        });
        child.stdin.end();
      }
      for (const early of ['closed-pipe', 'not-a-pipe']) {
        const child = Bun.spawn([executable], {
          stdin: early === 'closed-pipe' ? 'pipe' : 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (early === 'closed-pipe' && child.stdin) child.stdin.end();
        const output = await new Response(child.stdout).text();
        expect(await child.exited, await new Response(child.stderr).text()).toBe(0);
        const result = JSON.parse(output.slice(output.indexOf('\n') + 1));
        expect(result.visibleBeforeMainDrain).toBe(true);
        expect(result.callbacks).toBe(1);
        expect(result.onMain).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  90000,
);
