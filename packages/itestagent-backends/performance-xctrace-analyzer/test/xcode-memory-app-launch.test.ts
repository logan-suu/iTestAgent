import { afterEach, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { preflightMemoryApp } from '../src/xcode-memory-app-launch.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync('/private/tmp/itestagent-app-launch-');
  roots.push(root);
  const requestRoot = join(root, 'requests');
  mkdirSync(requestRoot, { mode: 0o700 });
  return {
    input: { root, requestRoot, xcodePath: '/Applications/Xcode.app' },
    resolve: async () => ({ appPath: '/fixture.app', launcherPath: '/fixture-launcher' }),
  };
}
function output(args: string[], reason = 'completed') {
  const requestId = args[2];
  const events = [
    { protocolVersion: 1, requestId, event: 'launch_requested' },
    { protocolVersion: 1, requestId, event: 'launched', pid: 123 },
    { protocolVersion: 1, requestId, event: 'closed', cleanupVerified: true, reason },
  ];
  return {
    stdout: events.map((x) => JSON.stringify(x)).join('\n'),
    stderr: '',
    exitCode: 0,
    interrupted: false,
  };
}
function result(args: string[], overrides = {}) {
  const directory = args[3];
  if (!directory) throw new Error('missing test directory');
  writeFileSync(
    join(directory, 'result.json'),
    JSON.stringify({
      protocolVersion: 1,
      requestId: args[2],
      status: 'eligible',
      reason: 'xcode_not_running',
      targetVerified: false,
      xcodeVersion: '26.5',
      ...overrides,
    }),
    { mode: 0o600 },
  );
}

test('accepts only a bound result after the owned application exits', async () => {
  const f = fixture();
  let release: (() => void) | undefined;
  let spawned: (() => void) | undefined;
  const ready = new Promise<void>((r) => {
    spawned = r;
  });
  let done = false;
  const pending = preflightMemoryApp(f.input, {
    resolve: f.resolve,
    spawn: async (args) => {
      result(args);
      spawned?.();
      await new Promise<void>((r) => {
        release = r;
      });
      return output(args);
    },
  }).then((value) => {
    done = true;
    return value;
  });
  await ready;
  expect(done).toBe(false);
  expect(existsSync(join(f.input.root, 'memory-app.lock'))).toBe(true);
  release?.();
  expect(await pending).toMatchObject({
    status: 'eligible',
    targetVerified: false,
    cleanupVerified: true,
  });
  expect(readdirSync(f.input.requestRoot)).toEqual([]);
  expect(existsSync(join(f.input.root, 'memory-app.lock'))).toBe(false);
});

test('fake, stale, missing and symlinked results never become eligible', async () => {
  for (const mode of [
    'wrong_request',
    'unknown_field',
    'missing',
    'symlink',
    'oversized',
    'truncated',
  ]) {
    const f = fixture();
    const value = await preflightMemoryApp(f.input, {
      resolve: f.resolve,
      spawn: async (args) => {
        const dir = args[3];
        if (!dir) throw new Error('missing directory');
        if (mode === 'wrong_request') result(args, { requestId: 'old' });
        if (mode === 'unknown_field') result(args, { privateAX: 'forbidden' });
        if (mode === 'symlink') symlinkSync('/etc/hosts', join(dir, 'result.json'));
        if (mode === 'oversized')
          writeFileSync(join(dir, 'result.json'), 'x'.repeat(2049), { mode: 0o600 });
        if (mode === 'truncated') writeFileSync(join(dir, 'result.json'), '{', { mode: 0o600 });
        return output(args);
      },
    });
    expect(value.status).toBe('blocked');
    expect(value.cleanupVerified).toBe(true);
  }
});

test('missing or false cleanup proof retains the lease and blocks retry', async () => {
  for (const mode of ['missing', 'false', 'wrong_request', 'multiple']) {
    const f = fixture();
    const value = await preflightMemoryApp(f.input, {
      resolve: f.resolve,
      spawn: async (args) => {
        result(args);
        const r = output(args);
        if (mode === 'missing') r.stdout = '';
        if (mode === 'false')
          r.stdout = r.stdout.replace('"cleanupVerified":true', '"cleanupVerified":false');
        if (mode === 'wrong_request') r.stdout = r.stdout.replaceAll(args[2] ?? '', 'old');
        if (mode === 'multiple') r.stdout += `\n${r.stdout}`;
        return r;
      },
    });
    expect(value).toMatchObject({ status: 'blocked', cleanupVerified: false });
    let calls = 0;
    expect(
      (
        await preflightMemoryApp(f.input, {
          resolve: f.resolve,
          spawn: async (args) => {
            calls++;
            return output(args);
          },
        })
      ).reason,
    ).toBe('instance_conflict');
    expect(calls).toBe(0);
  }
});

test('cancellation before callback waits for verified cleanup and never uses a result', async () => {
  const f = fixture();
  const abort = new AbortController();
  const value = await preflightMemoryApp(
    { ...f.input, signal: abort.signal },
    {
      resolve: f.resolve,
      spawn: async (args) => {
        abort.abort();
        result(args);
        return output(args, 'cancelled');
      },
    },
  );
  expect(value).toMatchObject({ reason: 'cancelled', cleanupVerified: true });
  expect(existsSync(join(f.input.root, 'memory-app.lock'))).toBe(false);
});

test('timeouts, launch errors and conflict do not report success', async () => {
  for (const reason of ['timeout', 'launch_failed', 'instance_conflict']) {
    const f = fixture();
    expect(
      await preflightMemoryApp(f.input, {
        resolve: f.resolve,
        spawn: async (args) => output(args, reason),
      }),
    ).toMatchObject({ reason, status: 'blocked', cleanupVerified: true });
  }
});

test('pre-abort and invalid private root never launch', async () => {
  const f = fixture();
  let calls = 0;
  const deps = {
    resolve: f.resolve,
    spawn: async (args: string[]) => {
      calls++;
      return output(args);
    },
  };
  expect((await preflightMemoryApp({ ...f.input, signal: AbortSignal.abort() }, deps)).reason).toBe(
    'cancelled',
  );
  expect((await preflightMemoryApp({ ...f.input, requestRoot: '/private/tmp' }, deps)).status).toBe(
    'blocked',
  );
  expect(calls).toBe(0);
});
