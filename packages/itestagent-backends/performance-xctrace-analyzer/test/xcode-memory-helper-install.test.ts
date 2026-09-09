import { afterEach, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { startCaptureProcess } from '../src/capture-process.js';
import {
  installMemoryHelper,
  preflightInstalledMemoryHelper,
  resolveInstalledMemoryHelper,
} from '../src/xcode-memory-helper-install.js';

const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture(hook?: (args: string[]) => void) {
  const parent = mkdtempSync('/private/tmp/itestagent-helper-test-');
  roots.push(parent);
  const input = { root: join(parent, 'installed'), xcodePath: '/Applications/Xcode.app' };
  const calls: string[][] = [];
  const spawn: typeof startCaptureProcess = (args) => {
    calls.push(args);
    hook?.(args);
    let stdout = '';
    if (args[0] === '/usr/bin/plutil') stdout = 'com.apple.dt.Xcode\n';
    else if (args.includes('--version'))
      stdout =
        'swift-driver version: 1.148.6 Apple Swift version 6.3.2 (swiftlang-fixture)\nTarget: arm64-apple-macosx26.0\n';
    else if (args.includes('-module-cache-path')) {
      const output = args.at(-1);
      if (!output) throw new Error('missing fixture output');
      writeFileSync(output, 'compiled read-only fixture');
      chmodSync(output, 0o700);
    } else if (args[0]?.endsWith('/itestagent-xcode-memory-helper'))
      stdout = JSON.stringify({
        protocolVersion: 1,
        status: 'blocked',
        reason: 'accessibility_unavailable',
        targetVerified: false,
        xcodeVersion: '26.5',
      });
    return {
      completed: Promise.resolve({ stdout, stderr: '', exitCode: 0, failure: undefined }),
      cancel() {},
      stop() {},
    };
  };
  return { input, parent, calls, deps: { spawn, platform: 'darwin' } };
}

test('first installation verifies before publishing and reuses without rebuilding', async () => {
  const f = fixture();
  const result = await installMemoryHelper(f.input, f.deps);
  expect(result.status).toBe('installed');
  const compile = f.calls.find((c) => c.includes('-module-cache-path'));
  expect(compile?.[0]).toStartWith(f.input.xcodePath);
  expect(compile?.[Number(compile?.indexOf('-sdk')) + 1]).toBe(
    join(
      f.input.xcodePath,
      'Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
    ),
  );
  expect(existsSync(result.helperPath)).toBe(true);
  const before = readFileSync(join(f.input.root, 'install.json'), 'utf8');
  const count = f.calls.length;
  expect((await installMemoryHelper(f.input, f.deps)).status).toBe('reused');
  expect(
    f.calls.slice(count).every((c) => c[0] === '/usr/bin/codesign' && c.includes('--verify')),
  ).toBe(true);
  expect(readFileSync(join(f.input.root, 'install.json'), 'utf8')).toBe(before);
  expect(readdirSync(f.parent)).toEqual(['installed']);
  expect(
    await preflightInstalledMemoryHelper(
      {
        ...f.input,
        target: { kind: 'physical', deviceId: 'fixture', bundleId: 'com.example.fixture' },
      },
      f.deps,
    ),
  ).toMatchObject({ reason: 'accessibility_unavailable', targetVerified: false });
});

test('unknown destination is never modified', async () => {
  const f = fixture();
  mkdirSync(f.input.root);
  writeFileSync(join(f.input.root, 'user-file'), 'keep');
  await expect(installMemoryHelper(f.input, f.deps)).rejects.toThrow('helper.installation_failed');
  expect(readdirSync(f.input.root)).toEqual(['user-file']);
  expect(f.calls).toHaveLength(0);
});

test('tampered binary, missing marker, added files and symlinks cannot resolve', async () => {
  for (const mutation of ['binary', 'marker', 'extra', 'symlink']) {
    const f = fixture();
    const { helperPath } = await installMemoryHelper(f.input, f.deps);
    if (mutation === 'binary') writeFileSync(helperPath, 'changed');
    if (mutation === 'marker') rmSync(join(f.input.root, 'install.json'));
    if (mutation === 'extra')
      writeFileSync(join(f.input.root, 'iTestAgentMemoryHelper.app/extra'), 'extra');
    if (mutation === 'symlink') {
      rmSync(helperPath);
      symlinkSync('/usr/bin/true', helperPath);
    }
    await expect(resolveInstalledMemoryHelper(f.input, f.deps)).rejects.toThrow(
      'helper.installation_invalid',
    );
  }
});

test('rejects symlink roots and traversal before spawning', async () => {
  const f = fixture();
  symlinkSync(f.parent, f.input.root);
  await expect(installMemoryHelper(f.input, f.deps)).rejects.toThrow('helper.installation_failed');
  await expect(
    installMemoryHelper({ ...f.input, root: `${f.parent}/x/../y` }, f.deps),
  ).rejects.toThrow('helper.installation_failed');
  expect(f.calls).toHaveLength(0);
});

test('compiler and signing failures leave no installed or staging content', async () => {
  for (const flag of ['-module-cache-path', '--sign', '--verify']) {
    const f = fixture((args) => {
      if (args.includes(flag)) throw new Error('private diagnostic');
    });
    await expect(installMemoryHelper(f.input, f.deps)).rejects.toThrow(
      'helper.installation_failed',
    );
    expect(readdirSync(f.parent)).toEqual([]);
  }
});

test('cancellation stops publication and preserves stable error', async () => {
  const abort = new AbortController();
  const f = fixture((args) => {
    if (args.includes('--sign')) abort.abort();
  });
  await expect(installMemoryHelper({ ...f.input, signal: abort.signal }, f.deps)).rejects.toThrow(
    'helper.cancelled',
  );
  expect(readdirSync(f.parent)).toEqual([]);
});

test('a concurrent reservation cannot be overwritten', async () => {
  const f = fixture((args) => {
    if (args.includes('--verify')) {
      mkdirSync(f.input.root);
      writeFileSync(join(f.input.root, 'competitor'), 'keep');
    }
  });
  await expect(installMemoryHelper(f.input, f.deps)).rejects.toThrow('helper.installation_failed');
  expect(readdirSync(f.input.root)).toEqual(['competitor']);
  expect(readdirSync(f.parent)).toEqual(['installed']);
});
