import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaptureProcess } from './capture-process.js';
import { type XcodeMemoryPreflightInput, preflightXcodeMemory } from './xcode-memory-preflight.js';

const bundleName = 'iTestAgentMemoryHelper.app';
const executable = 'itestagent-xcode-memory-helper';
const bundleId = 'com.itestagent.memory-helper';
const source = fileURLToPath(
  new URL('../native/itestagent-xcode-memory-helper.swift', import.meta.url),
);
const launcherName = 'itestagent-memory-launcher';
const launcherSource = fileURLToPath(
  new URL('../native/itestagent-memory-launcher.swift', import.meta.url),
);
const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleExecutable</key><string>${executable}</string><key>CFBundleName</key><string>iTestAgent Memory Helper</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>0.2.0</string><key>LSUIElement</key><true/></dict></plist>`;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const fail = () => {
  throw new Error('helper.installation_invalid');
};

/** Reject symlinks in every existing path component, including a caller-supplied root. */
function safePath(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path || /[\0\r\n]/.test(path)) fail();
  let current = parse(path).root;
  for (const component of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) fail();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
function exists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
function files(root: string, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const relative = join(prefix, name);
    const path = join(root, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail();
    if (stat.isDirectory()) Object.assign(result, files(root, relative));
    else if (stat.isFile()) result[relative] = hash(readFileSync(path));
    else fail();
  }
  return result;
}
export interface HelperInstallInput {
  root: string;
  xcodePath: string;
  signal?: AbortSignal;
}
type Dependencies = { spawn?: typeof startCaptureProcess; platform?: string };
async function command(args: string[], input: HelperInstallInput, deps: Dependencies) {
  input.signal?.throwIfAborted();
  const result = await (deps.spawn ?? startCaptureProcess)(args, {
    signal: input.signal,
    timeoutMs: 120_000,
  }).completed;
  if (input.signal?.aborted) throw new Error('helper.cancelled');
  if (result.failure || result.exitCode !== 0) throw new Error('helper.command_failed');
  return result.stdout;
}
function validateInput(input: HelperInstallInput, deps: Dependencies) {
  if ((deps.platform ?? process.platform) !== 'darwin') fail();
  input.signal?.throwIfAborted();
  safePath(input.root);
  safePath(input.xcodePath);
}

/** Reverify content and the system signature before returning an executable. */
async function resolveHelper(input: HelperInstallInput, deps: Dependencies = {}) {
  validateInput(input, deps);
  const app = join(input.root, bundleName);
  safePath(app);
  const manifestPath = join(input.root, 'install.json');
  safePath(manifestPath);
  safePath(join(input.root, launcherName));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.protocolVersion !== 1 ||
    manifest.launcherSourceHash !== hash(readFileSync(launcherSource)) ||
    manifest.launcherHash !== hash(readFileSync(join(input.root, launcherName))) ||
    manifest.bundleId !== bundleId ||
    manifest.sourceHash !== hash(readFileSync(source)) ||
    manifest.plistHash !== hash(plist) ||
    typeof manifest.toolchain !== 'string' ||
    !/^Apple Swift version [^\r\n]{1,180}$/.test(manifest.toolchain) ||
    JSON.stringify(manifest.files) !== JSON.stringify(files(app))
  )
    fail();
  if (readFileSync(join(app, 'Contents/Info.plist'), 'utf8') !== plist) fail();
  await command(['/usr/bin/codesign', '--verify', '--strict', app], input, deps);
  await command(
    ['/usr/bin/codesign', '--verify', '--strict', join(input.root, launcherName)],
    input,
    deps,
  );
  input.signal?.throwIfAborted();
  return join(app, 'Contents/MacOS', executable);
}

/** First install only. A partial or conflicting destination is retained and never replaced. */
async function installHelper(input: HelperInstallInput, deps: Dependencies = {}) {
  validateInput(input, deps);
  if (exists(input.root))
    return {
      status: 'reused' as const,
      helperPath: await resolveInstalledMemoryHelper(input, deps),
    };
  safePath(dirname(input.root));
  mkdirSync(dirname(input.root), { recursive: true, mode: 0o700 });
  safePath(dirname(input.root));
  const staging = mkdtempSync(join(dirname(input.root), '.memory-helper-'));
  try {
    const app = join(staging, bundleName);
    const macos = join(app, 'Contents/MacOS');
    mkdirSync(macos, { recursive: true, mode: 0o700 });
    writeFileSync(join(app, 'Contents/Info.plist'), plist, { flag: 'wx', mode: 0o600 });
    const xcodeId = await command(
      [
        '/usr/bin/plutil',
        '-extract',
        'CFBundleIdentifier',
        'raw',
        '-o',
        '-',
        join(input.xcodePath, 'Contents/Info.plist'),
      ],
      input,
      deps,
    );
    if (xcodeId.trim() !== 'com.apple.dt.Xcode') fail();
    const compiler = join(
      input.xcodePath,
      'Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc',
    );
    const toolchain = (await command([compiler, '--version'], input, deps))
      .match(/(?:^| )Apple Swift version [^\r\n]{1,160}/)?.[0]
      ?.trim();
    if (!toolchain || !/^Apple Swift version [^\r\n]{1,180}$/.test(toolchain)) fail();
    await command(
      [
        compiler,
        '-sdk',
        join(
          input.xcodePath,
          'Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
        ),
        '-module-cache-path',
        join(staging, 'cache'),
        source,
        '-o',
        join(macos, executable),
      ],
      input,
      deps,
    );
    await command(['/usr/bin/codesign', '--sign', '-', '--identifier', bundleId, app], input, deps);
    await command(['/usr/bin/codesign', '--verify', '--strict', app], input, deps);
    await command(
      [
        compiler,
        '-sdk',
        join(
          input.xcodePath,
          'Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
        ),
        '-module-cache-path',
        join(staging, 'cache'),
        launcherSource,
        '-o',
        join(staging, launcherName),
      ],
      input,
      deps,
    );
    await command(
      [
        '/usr/bin/codesign',
        '--sign',
        '-',
        '--identifier',
        'com.itestagent.memory-launcher',
        join(staging, launcherName),
      ],
      input,
      deps,
    );
    await command(
      ['/usr/bin/codesign', '--verify', '--strict', join(staging, launcherName)],
      input,
      deps,
    );
    const inventory = files(app);
    if (!inventory[`Contents/MacOS/${executable}`]) fail();
    input.signal?.throwIfAborted();
    safePath(input.root);
    // Exclusive reservation is the no-overwrite publication boundary. The marker is written last.
    mkdirSync(input.root, { mode: 0o700 });
    for (const relative of Object.keys(inventory)) {
      const dest = join(input.root, bundleName, relative);
      mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
      copyFileSync(join(app, relative), dest, constants.COPYFILE_EXCL);
    }
    copyFileSync(
      join(staging, launcherName),
      join(input.root, launcherName),
      constants.COPYFILE_EXCL,
    );
    writeFileSync(
      join(input.root, 'install.json'),
      JSON.stringify({
        schemaVersion: 2,
        launcherHash: hash(readFileSync(join(staging, launcherName))),
        launcherSourceHash: hash(readFileSync(launcherSource)),
        protocolVersion: 1,
        bundleId,
        sourceHash: hash(readFileSync(source)),
        plistHash: hash(plist),
        toolchain,
        files: inventory,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    return {
      status: 'installed' as const,
      helperPath: await resolveInstalledMemoryHelper(input, deps),
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function preflightInstalledMemoryHelper(
  input: HelperInstallInput & { target: XcodeMemoryPreflightInput['target'] },
  deps: Dependencies = {},
) {
  try {
    const helperPath = await resolveInstalledMemoryHelper(input, deps);
    return await preflightXcodeMemory({ ...input, helperPath }, deps);
  } catch {
    return {
      status: 'blocked' as const,
      reason: input.signal?.aborted ? 'cancelled' : 'installation_invalid',
      targetVerified: false as const,
    };
  }
}

/** Only stable error codes cross the installer API; paths and tool output stay local. */
export async function resolveInstalledMemoryHelper(
  input: HelperInstallInput,
  deps: Dependencies = {},
) {
  try {
    return await resolveHelper(input, deps);
  } catch {
    throw new Error(input.signal?.aborted ? 'helper.cancelled' : 'helper.installation_invalid');
  }
}
export async function installMemoryHelper(input: HelperInstallInput, deps: Dependencies = {}) {
  try {
    return await installHelper(input, deps);
  } catch {
    throw new Error(input.signal?.aborted ? 'helper.cancelled' : 'helper.installation_failed');
  }
}

/** Caller chooses a new staging root; this never upgrades an existing installation. */
export async function stageMemoryHelperCandidate(
  input: HelperInstallInput,
  deps: Dependencies = {},
) {
  if (exists(input.root)) throw new Error('helper.candidate_exists');
  return installMemoryHelper(input, deps);
}
export async function resolveMemoryAppLaunch(input: HelperInstallInput, deps: Dependencies = {}) {
  await resolveInstalledMemoryHelper(input, deps);
  return { appPath: join(input.root, bundleName), launcherPath: join(input.root, launcherName) };
}
