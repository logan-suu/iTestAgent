import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WdaReadinessError } from '../src/wda-launch-monitor.js';
import { WdaManager, type WdaManagerOptions } from '../src/wda-manager.js';

const managers: WdaManager[] = [];
const roots: string[] = [];
const launchOptions = { projectPath: '/fixture/WebDriverAgent.xcodeproj', udid: 'fixture-device' };
const expiredProfile = 'Failed to install embedded profile: This provisioning profile has expired.';

function managerFor(script: string, fetchStatus?: WdaManagerOptions['fetchStatus']) {
  const commands: string[][] = [];
  const manager = new WdaManager({
    spawnLaunch: (command, options) => {
      commands.push(command);
      // Execute a harmless real child, never Xcode or a device command.
      return Bun.spawn([process.execPath, '-e', script], options);
    },
    fetchStatus:
      fetchStatus ??
      (async () => {
        throw new Error('fixture socket closed');
      }),
  });
  managers.push(manager);
  return { manager, commands };
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stop(100)));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('managed WDA launch readiness', () => {
  test('reports an expired provisioning profile promptly instead of waiting for status timeout', async () => {
    const { manager, commands } = managerFor(
      `console.error(${JSON.stringify(expiredProfile)}); process.exit(65);`,
    );
    const child = await manager.launch(launchOptions);
    await child.process.exited;
    const start = Date.now();
    const error = await manager.waitForReady(8100, 1500).catch((error) => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('provisioning profile has expired');
    expect((error as Error).message).toContain('explicit confirmation');
    expect((error as Error).message).not.toContain('/status not ready after');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.slice(0, 3)).toEqual(['xcrun', 'xcodebuild', 'test-without-building']);
    expect(manager.isRunning()).toBe(false);
  });

  test('does not accept another status responder after the owned launch already exited', async () => {
    const { manager } = managerFor('process.exit(0);', async () =>
      Response.json({ value: { ready: true } }),
    );
    const child = await manager.launch(launchOptions);
    await child.process.exited;
    await expect(manager.waitForReady(8100, 1500)).rejects.toThrow('exited before readiness');
  });

  test('keeps a live process status timeout distinct from signing failure', async () => {
    const { manager } = managerFor('setInterval(() => {}, 1000);');
    await manager.launch(launchOptions);
    await expect(manager.waitForReady(8100, 50)).rejects.toThrow('WDA /status not ready');
    expect(manager.isRunning()).toBe(true);
  });

  test('accepts ready only while the owned launch is still alive', async () => {
    const { manager } = managerFor('setInterval(() => {}, 1000);', async () =>
      Response.json({ value: { ready: true, build: { time: 'fixture-build' } } }),
    );
    await manager.launch(launchOptions);
    await expect(manager.waitForReady(8100)).resolves.toMatchObject({
      ready: true,
      version: { build: { time: 'fixture-build' } },
    });
    expect(manager.isRunning()).toBe(true);
  });

  test('launch exit interrupts an in-flight status request and drains split diagnostics', async () => {
    let requestSignal: AbortSignal | undefined;
    const { manager } = managerFor(
      'await Bun.sleep(150); await Bun.write(Bun.stderr, "This provisioning pro"); ' +
        'await Bun.sleep(20); await Bun.write(Bun.stderr, "file has expired."); process.exit(65);',
      async (_url, { signal }) => {
        requestSignal = signal;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    );
    await manager.launch(launchOptions);
    const start = Date.now();
    await expect(manager.waitForReady(8100, 5000)).rejects.toThrow(
      'provisioning profile has expired',
    );
    expect(Date.now() - start).toBeLessThan(1500);
    expect(requestSignal?.aborted).toBe(true);
  });

  test('drains large stdout and stderr without leaking raw diagnostic values', async () => {
    const privateValue = 'fixture-private-value-should-not-escape';
    const { manager } = managerFor(
      `await Bun.write(Bun.stdout, "x".repeat(200000));
       await Bun.write(Bun.stdout, ${JSON.stringify(`${expiredProfile}\n`)});
       await Bun.write(Bun.stderr, "y".repeat(200000) + ${JSON.stringify(privateValue)});
       process.exit(65);`,
    );
    await manager.launch(launchOptions);
    const error = await manager.waitForReady(8100, 5000).catch((error) => error);
    expect(error).toBeInstanceOf(WdaReadinessError);
    expect(error.failureCode).toBe('wda_signing_or_configuration_failed');
    expect(error.message).toContain('provisioning profile has expired');
    expect(error.message).not.toContain(privateValue);
    expect(error.message.length).toBeLessThan(1000);
  });

  for (const diagnostic of [
    'No signing certificate found.',
    'Unable to install the WDA Runner.',
    'The provisioning profile has not expired; an unrelated XCTest error occurred.',
  ]) {
    test(`does not infer profile expiration from ${diagnostic}`, async () => {
      const { manager } = managerFor(
        `console.error(${JSON.stringify(diagnostic)}); process.exit(65);`,
      );
      await manager.launch(launchOptions);
      const error = await manager.waitForReady(8100, 5000).catch((error) => error);
      expect(error).toBeInstanceOf(WdaReadinessError);
      expect(error.failureCode).toBe(
        diagnostic.startsWith('No signing')
          ? 'wda_signing_or_configuration_failed'
          : 'wda_launch_failed',
      );
      expect(error.message).not.toContain('profile has expired');
    });
  }

  test('omits unknown raw failures but preserves the launch exit code', async () => {
    const { manager } = managerFor(
      'console.error("fixture-sensitive-unknown-failure"); process.exit(70);',
    );
    await manager.launch(launchOptions);
    const error = await manager.waitForReady(8100, 5000).catch((error) => error);
    expect(error.failureCode).toBe('wda_launch_failed');
    expect(error.message).toContain('exit code 70');
    expect(error.message).toContain('local Xcode test result');
    expect(error.message).not.toContain('fixture-sensitive-unknown-failure');
  });

  test('rejects a non-success HTTP response even when its body says ready', async () => {
    const { manager } = managerFor('setInterval(() => {}, 1000);', async () =>
      Response.json({ value: { ready: true } }, { status: 503 }),
    );
    await manager.launch(launchOptions);
    const error = await manager.waitForReady(8100, 50).catch((error) => error);
    expect(error.failureCode).toBe('wda_status_failed');
    expect(error.message).toContain('HTTP 503');
  });

  test('status deadline aborts a pending request without fabricating a launch error', async () => {
    let requestSignal: AbortSignal | undefined;
    const { manager } = managerFor('setInterval(() => {}, 1000);', async (_url, { signal }) => {
      requestSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    await manager.launch(launchOptions);
    const error = await manager.waitForReady(8100, 50).catch((error) => error);
    expect(error.failureCode).toBe('wda_status_failed');
    expect(requestSignal?.aborted).toBe(true);
    expect(manager.isRunning()).toBe(true);
  });

  test('run cancellation aborts status transport and allows owned-child cleanup', async () => {
    const controller = new AbortController();
    let started: () => void = () => {};
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let requestSignal: AbortSignal | undefined;
    const { manager } = managerFor('setInterval(() => {}, 1000);', async (_url, { signal }) => {
      requestSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        started();
      });
    });
    const child = await manager.launch({ ...launchOptions, signal: controller.signal });
    const outcome = manager.waitForReady(8100, 5000, controller.signal).catch((error) => error);
    await requestStarted;
    controller.abort();
    expect((await outcome).message).toContain('cancelled');
    expect(requestSignal?.aborted).toBe(true);
    await manager.stop(100, controller.signal);
    expect(await child.process.exited).not.toBeNull();
    expect(manager.isRunning()).toBe(false);
  });

  test('a new launch cannot inherit the previous launch diagnostic', async () => {
    let launches = 0;
    const manager = new WdaManager({
      spawnLaunch: (_command, options) =>
        Bun.spawn(
          [
            process.execPath,
            '-e',
            launches++ === 0
              ? `console.error(${JSON.stringify(expiredProfile)}); process.exit(65);`
              : 'setInterval(() => {}, 1000);',
          ],
          options,
        ),
      fetchStatus: async () => Response.json({ value: { ready: true } }),
    });
    managers.push(manager);
    const child = await manager.launch(launchOptions);
    await child.process.exited;
    await expect(manager.waitForReady(8100)).rejects.toThrow('provisioning profile has expired');
    await manager.launch(launchOptions);
    await expect(manager.waitForReady(8100)).resolves.toMatchObject({ ready: true });
  });

  test('bounds drain after leader exit and cleans owned descendants retaining the pipes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'itestagent-wda-launch-'));
    roots.push(root);
    const pidPath = join(root, 'child.pid');
    const { manager } = managerFor(
      `const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000);"],
         { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
       await Bun.write(${JSON.stringify(pidPath)}, String(child.pid));
       console.error(${JSON.stringify(expiredProfile)}); process.exit(65);`,
    );
    const child = await manager.launch(launchOptions);
    await child.process.exited;
    const descendantPid = Number(readFileSync(pidPath, 'utf8'));
    expect(Number.isInteger(descendantPid) && descendantPid > 0).toBe(true);
    const start = Date.now();
    await expect(manager.waitForReady(8100, 1500)).rejects.toThrow(
      'provisioning profile has expired',
    );
    expect(Date.now() - start).toBeLessThan(1000);
    await manager.stop(100);
    const alive = () => {
      try {
        process.kill(descendantPid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    };
    for (let attempt = 0; attempt < 50 && alive(); attempt++) await Bun.sleep(10);
    expect(alive()).toBe(false);
  });

  test('reports a safe launch-stage error when the process cannot be spawned', async () => {
    const manager = new WdaManager({
      spawnLaunch: () => {
        throw new Error('fixture-private-spawn-failure');
      },
    });
    managers.push(manager);
    const error = await manager.launch(launchOptions).catch((error) => error);
    expect(error.failureCode).toBe('wda_launch_failed');
    expect(error.message).toContain('Xcode command-line tools');
    expect(error.message).not.toContain('fixture-private-spawn-failure');
    expect(manager.isRunning()).toBe(false);
  });

  test('does not spawn WDA after an already-cancelled run', async () => {
    const { manager, commands } = managerFor('setInterval(() => {}, 1000);');
    const signal = AbortSignal.abort(new Error('fixture run cancelled'));
    await expect(manager.launch({ ...launchOptions, signal })).rejects.toThrow(
      'fixture run cancelled',
    );
    expect(commands).toEqual([]);
  });
});
