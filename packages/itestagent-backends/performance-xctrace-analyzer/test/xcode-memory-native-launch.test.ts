import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { preflightMemoryApp, startMemoryAppLauncher } from '../src/xcode-memory-app-launch.js';
import {
  resolveMemoryAppLaunch,
  stageMemoryHelperCandidate,
} from '../src/xcode-memory-helper-install.js';

// Explicit opt-in: this creates only a disposable, no-AX macOS test application.
const enabled = process.platform === 'darwin' && process.env.ITESTAGENT_NATIVE_LAUNCH_TEST === '1';
let parent = '';
let launcherPath = '';
let appPath = '';
const xcodePath = '/Applications/Xcode.app';
async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (code !== 0) throw new Error(`native fixture command failed: ${stderr}`);
}
beforeAll(async () => {
  if (!enabled) return;
  parent = mkdtempSync('/private/tmp/itestagent-native-launch-');
  const root = join(parent, 'candidate');
  await stageMemoryHelperCandidate({ root, xcodePath });
  launcherPath = (await resolveMemoryAppLaunch({ root, xcodePath })).launcherPath;
  appPath = join(parent, 'Fixture.app');
  mkdirSync(join(appPath, 'Contents/MacOS'), { recursive: true });
  const id = `com.itestagent.test.memory-launch.${randomUUID()}`;
  writeFileSync(
    join(appPath, 'Contents/Info.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
  );
  const source = join(parent, 'fixture.swift');
  writeFileSync(
    source,
    `import Foundation
import AppKit
import Darwin
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
application.finishLaunching()
let a = CommandLine.arguments
if a.count != 6 { exit(2) }
let value: [String: Any] = ["protocolVersion":1,"requestId":a[2],"status":"eligible","reason":"xcode_not_running","targetVerified":false,"xcodeVersion":"26.5"]
try! JSONSerialization.data(withJSONObject:value).write(to: URL(fileURLWithPath:a[4]+"/result.json"), options:.withoutOverwriting)
chmod(a[4]+"/result.json", 0o600)
if a[5] == "/fixture/hang" { sleep(30) }
`,
  );
  await run([
    '/usr/bin/xcrun',
    'swiftc',
    '-module-cache-path',
    join(parent, 'cache'),
    source,
    '-o',
    join(appPath, 'Contents/MacOS/fixture'),
  ]);
  await run(['/usr/bin/codesign', '--sign', '-', appPath]);
}, 120000);
afterAll(() => {
  if (!parent) return;
  const processes = Bun.spawnSync(['/bin/ps', '-axo', 'comm=']);
  expect(processes.exitCode).toBe(0);
  const names = processes.stdout
    .toString()
    .split('\n')
    .map((x) => x.trim());
  expect(
    names.some(
      (x) =>
        x === join(appPath, 'Contents/MacOS/fixture') ||
        x === join(appPath, 'Contents/MacOS/fixture').replace('/private/tmp/', '/tmp/'),
    ),
  ).toBe(false);
  rmSync(parent, { recursive: true, force: true });
});
function input() {
  const root = mkdtempSync(join(parent, 'case-'));
  const requestRoot = join(root, 'requests');
  mkdirSync(requestRoot, { mode: 0o700 });
  return { root, requestRoot, xcodePath: '/fixture/success', timeoutMs: 2000 };
}
const paths = async () => ({ appPath, launcherPath });

test.skipIf(!enabled)(
  'native staged launcher completes a no-AX App and validates its bound result',
  async () => {
    const i = input();
    const r = await preflightMemoryApp(i, {
      resolve: paths,
      spawn: async (...args) => {
        const value = await startMemoryAppLauncher(...args);
        return value;
      },
    });
    expect(r).toMatchObject({ status: 'eligible', cleanupVerified: true, targetVerified: false });
    expect(readdirSync(i.requestRoot)).toEqual([]);
  },
  15000,
);

test.skipIf(!enabled)(
  'native cancellation reaps the owned App despite an already written result',
  async () => {
    const i = { ...input(), xcodePath: '/fixture/hang' };
    const abort = new AbortController();
    let output = '';
    const timer = setInterval(() => {
      if (
        readdirSync(i.requestRoot).some((d) => {
          try {
            return !!readFileSync(join(i.requestRoot, d, 'result.json'));
          } catch {
            return false;
          }
        })
      )
        abort.abort();
    }, 20);
    try {
      const r = await preflightMemoryApp(
        { ...i, signal: abort.signal },
        {
          resolve: paths,
          spawn: async (...args) => {
            const r = await startMemoryAppLauncher(...args);
            output = r.stdout;

            return r;
          },
        },
      );
      expect(r).toMatchObject({ status: 'blocked', reason: 'cancelled', cleanupVerified: true });
      expect(output).toContain('"event":"launched"');
      expect(readdirSync(i.requestRoot)).toEqual([]);
    } finally {
      clearInterval(timer);
    }
  },
  15000,
);

test.skipIf(!enabled)(
  'native timeout reaps a non-responsive no-AX App',
  async () => {
    const r = await preflightMemoryApp(
      { ...input(), xcodePath: '/fixture/hang', timeoutMs: 300 },
      { resolve: paths },
    );
    expect(r).toMatchObject({ status: 'blocked', reason: 'timeout', cleanupVerified: true });
  },
  15000,
);

test.skipIf(!enabled)(
  'native existing-instance conflict does not terminate the other request',
  async () => {
    const first = input();
    const abort = new AbortController();
    let started: () => void = () => {};
    const ready = new Promise<void>((r) => {
      started = r;
    });
    const timer = setInterval(() => {
      if (
        readdirSync(first.requestRoot).some((d) => {
          try {
            return !!readFileSync(join(first.requestRoot, d, 'result.json'));
          } catch {
            return false;
          }
        })
      )
        started();
    }, 20);
    const pending = preflightMemoryApp(
      { ...first, xcodePath: '/fixture/hang', signal: abort.signal, timeoutMs: 5000 },
      { resolve: paths },
    );
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('fixture not ready')), 4000)),
      ]);
      const second = await preflightMemoryApp(input(), { resolve: paths });
      expect(second).toMatchObject({ reason: 'instance_conflict', cleanupVerified: true });
    } finally {
      clearInterval(timer);
      abort.abort();
      expect((await pending).cleanupVerified).toBe(true);
    }
  },
  15000,
);

test.skipIf(!enabled)(
  'native lifetime pipe EOF before callback still closes any late-owned App',
  async () => {
    const i = input();
    const requestId = randomUUID();
    const directory = join(i.requestRoot, `memory-request-${requestId}`);
    mkdirSync(directory, { mode: 0o700 });
    const child = Bun.spawn(
      [launcherPath, appPath, requestId, directory, '/fixture/hang', '2000'],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    );
    let text = '';
    const stderr = new Response(child.stderr).text();
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let closedPipe = false;
    const safety = setTimeout(() => child.stdin.end(), 3000);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
        if (!closedPipe && text.includes('launch_requested')) {
          closedPipe = true;
          child.stdin.end();
        }
      }
      expect(await child.exited).toBe(0);
      expect(await stderr).toBe('');
      expect(text).toContain('"cleanupVerified":true');
      expect(text).toContain('"reason":"cancelled"');
    } finally {
      clearTimeout(safety);
      reader.releaseLock();
      child.stdin.end();
    }
  },
  15000,
);

test.skipIf(!enabled)(
  'native result file mode rejects symlinks and cannot overwrite an earlier result',
  async () => {
    const id = randomUUID();
    const directory = join(parent, `memory-request-${id}`);
    mkdirSync(directory, { mode: 0o700 });
    const helper = join(
      parent,
      'candidate/iTestAgentMemoryHelper.app/Contents/MacOS/itestagent-xcode-memory-helper',
    );
    const args = [helper, '--request', id, '--directory', directory, '/fixture/missing-xcode'];
    await run(args);
    const before = readFileSync(join(directory, 'result.json'), 'utf8');
    expect(JSON.parse(before)).toMatchObject({
      requestId: id,
      reason: 'xcode_invalid',
      targetVerified: false,
    });
    const repeated = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
    expect(await repeated.exited).toBe(2);
    expect(readFileSync(join(directory, 'result.json'), 'utf8')).toBe(before);
    const otherID = randomUUID();
    const other = join(parent, `memory-request-${otherID}`);
    mkdirSync(other, { mode: 0o700 });
    symlinkSync(join(directory, 'result.json'), join(other, 'result.json'));
    const linked = Bun.spawn(
      [helper, '--request', otherID, '--directory', other, '/fixture/missing-xcode'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(await linked.exited).toBe(2);
    expect(readFileSync(join(directory, 'result.json'), 'utf8')).toBe(before);
  },
  15000,
);
