import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startCaptureProcess } from '../src/capture-process.js';
import { runOwnedMemorySession } from '../src/xcode-memory-owned-session.js';

const enabled = process.platform === 'darwin' && process.env.ITESTAGENT_NATIVE_LAUNCH_TEST === '1';
test.skipIf(!enabled)(
  'owned App lifecycle verifies normal and cancelled exits without force termination',
  async () => {
    const root = mkdtempSync('/private/tmp/itestagent-owned-app-');
    const app = join(root, 'Fixture.app');
    const executable = join(app, 'Contents/MacOS/fixture');
    const driver = join(root, 'driver');
    const identifier = `com.itestagent.test.owned-app.${randomUUID()}`;
    async function command(args: string[]) {
      const result = await startCaptureProcess(args, { timeoutMs: 60000 }).completed;
      expect(result.exitCode, result.stderr).toBe(0);
    }
    try {
      mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
      writeFileSync(
        join(app, 'Contents/Info.plist'),
        `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
      );
      const source = join(root, 'fixture.swift');
      writeFileSync(
        source,
        'import AppKit\nimport Darwin\nalarm(15)\nlet app = NSApplication.shared\napp.setActivationPolicy(.prohibited)\napp.run()\n',
      );
      await command([
        'xcrun',
        'swiftc',
        '-module-cache-path',
        join(root, 'cache'),
        source,
        '-o',
        executable,
      ]);
      await command(['/usr/bin/codesign', '--sign', '-', app]);
      await command([
        'xcrun',
        'swiftc',
        '-warnings-as-errors',
        '-module-cache-path',
        join(root, 'cache'),
        join(import.meta.dir, '../native/itestagent-memory-owned-app.swift'),
        join(import.meta.dir, '../native/itestagent-memory-parent-lifetime.swift'),
        join(import.meta.dir, 'memory-owned-app-fixture.swift'),
        '-o',
        driver,
      ]);
      const result = await startCaptureProcess([driver, app, identifier], { timeoutMs: 25000 })
        .completed;
      expect(result.failure).toBeUndefined();
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        policy: true,
        ownedExit: true,
        conflictUntouched: true,
        cancelDuringLaunch: true,
        cleanupVerified: true,
      });
      for (const cancellation of ['eof', 'SIGTERM', 'SIGINT', 'early-eof'] as const) {
        const helpersRoot = realpathSync(mkdtempSync(join(root, 'lease-')));
        const ready = join(helpersRoot, 'ready');
        let diagnostic = '';
        const outcome = await runOwnedMemorySession(
          {
            helpersRoot,
            target: {
              deviceId: 'fixture',
              bundleId: identifier,
              buildReference: 'fixture',
              executable,
            },
          },
          async (sessionId) => {
            const child = Bun.spawn([driver, app, identifier, '--lifetime', sessionId, ready], {
              stdin: 'pipe',
              stdout: 'pipe',
              stderr: 'pipe',
            });
            const output = new Response(child.stdout).text();
            const errors = new Response(child.stderr).text();
            const watchdog = setTimeout(() => child.kill('SIGKILL'), 15000);
            try {
              if (cancellation === 'early-eof') child.stdin.end();
              else {
                const deadline = Date.now() + 5000;
                while (!existsSync(ready) && child.exitCode === null && Date.now() < deadline)
                  await new Promise((resolve) => setTimeout(resolve, 20));
                expect(existsSync(ready)).toBe(true);
                if (cancellation === 'eof') child.stdin.end();
                else child.kill(cancellation);
              }
              const exitCode = await child.exited;
              const stdout = await output;
              const stderr = await errors;
              diagnostic = `${cancellation}: exit=${exitCode}; ${stdout}; ${stderr}`;
              return { stdout, stderr, exitCode, interrupted: true };
            } finally {
              child.stdin.end();
              await child.exited;
              clearTimeout(watchdog);
            }
          },
        );
        expect(outcome, diagnostic).toEqual({
          reason: 'cancelled',
          cleanupVerified: true,
          leaseRetained: false,
        });
        expect(existsSync(join(helpersRoot, 'xcode-memory-session.lock'))).toBe(false);
        if (cancellation === 'early-eof') expect(existsSync(ready)).toBe(false);
      }
    } finally {
      // A failed driver cannot justify deleting a still-running App bundle. The
      // disposable fixture has its own 15-second lifetime even if its owner fails.
      let alive = true;
      const deadline = Date.now() + 16000;
      while (alive && Date.now() < deadline) {
        const ps = Bun.spawnSync(['/bin/ps', '-axo', 'comm=']);
        expect(ps.exitCode).toBe(0);
        alive = ps.stdout
          .toString()
          .split('\n')
          .some((line) =>
            [executable, executable.replace('/private/tmp/', '/tmp/')].includes(line.trim()),
          );
        if (alive) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(alive).toBe(false);
      if (!alive) rmSync(root, { recursive: true, force: true });
    }
  },
  120000,
);
