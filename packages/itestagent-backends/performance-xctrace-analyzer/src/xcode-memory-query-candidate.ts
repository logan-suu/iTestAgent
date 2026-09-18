import { createHash } from 'node:crypto';
import {
  constants,
  closeSync,
  copyFileSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { startCaptureProcess } from './capture-process.js';
import { spawnMemoryQueryLauncher } from './xcode-memory-query-launcher.js';
import { noTargetSourceDigests } from './xcode-memory-query-profile.js';

export const queryNativeSources = [
  'itestagent-memory-ax-capabilities.swift',
  'itestagent-memory-ax-context.swift',
  'itestagent-memory-local-document.swift',
  'itestagent-memory-identity-script.swift',
  'itestagent-memory-console-response.swift',
  'itestagent-memory-console-location.swift',
  'itestagent-memory-console-submit.swift',
  'itestagent-memory-console-return.swift',
  'itestagent-memory-owned-app.swift',
  'itestagent-memory-query-session.swift',
  'itestagent-memory-parent-lifetime.swift',
  'itestagent-memory-query-ipc.swift',
  'itestagent-memory-query-ipc-grant.swift',
  'itestagent-memory-query-launcher.swift',
  'itestagent-memory-query-app-launch.swift',
  'itestagent-memory-query-control.swift',
  'itestagent-memory-query-candidate.swift',
  'itestagent-memory-query-helper-session.swift',
  'itestagent-memory-query-closure-receipt.swift',
] as const;
const entries = [
  'itestagent-memory-query-launcher-main.swift',
  'itestagent-memory-query-helper-main.swift',
] as const;
const resource = 'itestagent_memory_identity.py';
const appName = 'iTestAgentMemoryQueryHelper.app';
const executable = `${appName}/Contents/MacOS/itestagent-memory-query-helper`;
const launcherName = 'itestagent-memory-query-launcher';
const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.itestagent.memory-query-helper</string><key>CFBundleExecutable</key><string>itestagent-memory-query-helper</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>LSUIElement</key><true/></dict></plist>`;
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const v3Schema = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(3),
    purpose: z.literal('offline-query-candidate'),
    toolchain: z.string().regex(/^Apple Swift version [^\r\n]{1,180}$/),
    files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict();
const schema = z.union([
  v3Schema,
  v3Schema
    .extend({ protocolVersion: z.literal(4), profile: z.literal('no_target_resources') })
    .strict(),
]);
function safeRoot(root: string) {
  if (resolve(root) !== root || realpathSync(root) !== root)
    throw new Error('query.candidate_invalid');
  const info = lstatSync(root);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
    throw new Error('query.candidate_invalid');
}
function inventory(root: string) {
  safeRoot(root);
  const files: Record<string, string> = {};
  let total = 0;
  let nodes = 0;
  function visit(relative: string, depth: number) {
    if (depth > 10) throw new Error('query.candidate_invalid');
    for (const name of readdirSync(join(root, relative)).sort()) {
      if (++nodes > 256 || /[\0\r\n]/.test(name)) throw new Error('query.candidate_invalid');
      const path = join(relative, name);
      if (path === 'candidate.json') continue;
      const info = lstatSync(join(root, path));
      if (info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0 || info.isSymbolicLink())
        throw new Error('query.candidate_invalid');
      if (info.isDirectory()) {
        visit(path, depth + 1);
        continue;
      }
      total += info.size;
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size > 32 * 1024 * 1024 ||
        total > 128 * 1024 * 1024
      )
        throw new Error('query.candidate_invalid');
      const fd = openSync(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = fstatSync(fd);
        if (current.dev !== info.dev || current.ino !== info.ino)
          throw new Error('query.candidate_invalid');
        files[path] = digest(readFileSync(fd));
      } finally {
        closeSync(fd);
      }
    }
  }
  visit('', 0);
  return files;
}
const requiredFiles = [...queryNativeSources, ...entries, resource]
  .map((x) => `sources/${x}`)
  .concat([
    executable,
    launcherName,
    `${appName}/Contents/Info.plist`,
    `${appName}/Contents/Resources/${resource}`,
  ]);
export function reviewMemoryQueryCandidate(root: string, expectedDigest: string) {
  safeRoot(root);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('query.candidate_invalid');
  const path = join(root, 'candidate.json');
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0 ||
    info.size > 65536
  )
    throw new Error('query.candidate_invalid');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw: Buffer;
  try {
    if (fstatSync(fd).ino !== info.ino) throw new Error('query.candidate_invalid');
    raw = readFileSync(fd);
  } finally {
    closeSync(fd);
  }
  if (digest(raw) !== expectedDigest) throw new Error('query.candidate_changed');
  const manifest = schema.parse(JSON.parse(raw.toString('utf8')));
  const actual = inventory(root);
  if (
    JSON.stringify(Object.entries(actual).sort()) !==
      JSON.stringify(Object.entries(manifest.files).sort()) ||
    requiredFiles.some(
      (x) =>
        !actual[x] &&
        !(
          manifest.protocolVersion === 3 &&
          x === 'sources/itestagent-memory-query-closure-receipt.swift'
        ),
    )
  )
    throw new Error('query.candidate_changed');
  if (
    actual[`${appName}/Contents/Info.plist`] !== digest(plist) ||
    actual[`${appName}/Contents/Resources/${resource}`] !== actual[`sources/${resource}`]
  )
    throw new Error('query.candidate_invalid');
  if (
    manifest.protocolVersion === 4 &&
    (Object.keys(noTargetSourceDigests).length !==
      requiredFiles.filter((x) => x.startsWith('sources/')).length ||
      Object.entries(noTargetSourceDigests).some(
        ([file, hash]) => actual[`sources/${file}`] !== hash,
      ))
  )
    throw new Error('query.profile_unverified');
  return { manifest, manifestSHA256: expectedDigest, root };
}
/** A pinned manifest and real signature verification are both required. The trusted
 * signature adapter is injected for offline tests; its result is not loaded from JSON.
 */
async function resolveCandidate(
  root: string,
  expectedDigest: string,
  verifySignature: (path: string) => Promise<boolean> = async (path) => {
    const result = await startCaptureProcess(['/usr/bin/codesign', '--verify', '--strict', path], {
      timeoutMs: 10000,
    }).completed;
    return result.exitCode === 0 && !result.failure;
  },
) {
  reviewMemoryQueryCandidate(root, expectedDigest);
  if (
    !(await verifySignature(join(root, appName))) ||
    !(await verifySignature(join(root, launcherName)))
  )
    throw new Error('query.signature_unverified');
  reviewMemoryQueryCandidate(root, expectedDigest);
  return Object.freeze({
    launch(signal?: AbortSignal) {
      signal?.throwIfAborted();
      reviewMemoryQueryCandidate(root, expectedDigest);
      return spawnMemoryQueryLauncher([join(root, launcherName), root, expectedDigest]);
    },
  });
}
/** Opaque resolver-issued handle. It is not serializable or caller-constructible. */
const noTargetCandidates = new WeakMap<
  object,
  {
    root: string;
    digest: string;
    launch(signal?: AbortSignal): ReturnType<typeof spawnMemoryQueryLauncher>;
  }
>();
export async function resolveMemoryQueryCandidate(
  root: string,
  digest: string,
  verifySignature?: (path: string) => Promise<boolean>,
) {
  if (reviewMemoryQueryCandidate(root, digest).manifest.protocolVersion !== 3)
    throw new Error('query.version_invalid');
  return resolveCandidate(root, digest, verifySignature);
}
export async function resolveMemoryNoTargetCandidate(
  root: string,
  digest: string,
  verifySignature?: (path: string) => Promise<boolean>,
) {
  if (reviewMemoryQueryCandidate(root, digest).manifest.protocolVersion !== 4)
    throw new Error('query.version_invalid');
  const verified = await resolveCandidate(root, digest, verifySignature);
  const capability = Object.freeze({});
  noTargetCandidates.set(capability, { root, digest, launch: verified.launch });
  return capability;
}
export function launchMemoryNoTargetCandidate(capability: object, signal?: AbortSignal) {
  const verified = noTargetCandidates.get(capability);
  if (!verified) throw new Error('query.candidate_unverified');
  noTargetCandidates.delete(capability);
  return {
    channel: verified.launch(signal),
    manifestSHA256: verified.digest,
    revalidate() {
      reviewMemoryQueryCandidate(verified.root, verified.digest);
    },
  };
}
export function stageMemoryNoTargetCandidate(root: string, signal?: AbortSignal) {
  return stageCandidate(root, signal, 4);
}
export function stageMemoryQueryCandidate(root: string, signal?: AbortSignal) {
  return stageCandidate(root, signal, 3);
}
/** Compile and inventory only. Never signs, installs, opens, or executes the candidate. */
async function stageCandidate(root: string, signal: AbortSignal | undefined, version: 3 | 4) {
  signal?.throwIfAborted();
  if (resolve(root) !== root || realpathSync(dirname(root)) !== dirname(root))
    throw new Error('query.candidate_invalid');
  mkdirSync(root, { mode: 0o700 });
  const cache = mkdtempSync('/private/tmp/itestagent-query-build-');
  const run = async (args: string[]) => {
    const result = await startCaptureProcess(args, { timeoutMs: 60000, signal }).completed;
    if (result.exitCode !== 0 || result.failure) throw new Error('query.candidate_build_failed');
    return result.stdout;
  };
  try {
    mkdirSync(join(root, 'sources'), { mode: 0o700 });
    for (const file of [...queryNativeSources, ...entries, resource])
      copyFileSync(
        join(import.meta.dir, '../native', file),
        join(root, 'sources', file),
        constants.COPYFILE_EXCL,
      );
    mkdirSync(join(root, appName, 'Contents/MacOS'), { recursive: true, mode: 0o700 });
    mkdirSync(join(root, appName, 'Contents/Resources'), { mode: 0o700 });
    writeFileSync(join(root, appName, 'Contents/Info.plist'), plist, { mode: 0o600, flag: 'wx' });
    copyFileSync(
      join(root, 'sources', resource),
      join(root, appName, 'Contents/Resources', resource),
      constants.COPYFILE_EXCL,
    );
    const versionOutput = await run(['xcrun', 'swiftc', '--version']);
    const toolchain = versionOutput.match(/Apple Swift version [^\r\n]+/)?.[0];
    if (!toolchain) throw new Error('query.toolchain_invalid');
    for (const [entry, output] of [
      [entries[0], launcherName],
      [entries[1], executable],
    ] as const)
      await run([
        'xcrun',
        'swiftc',
        '-warnings-as-errors',
        ...(version === 4 ? ['-D', 'MEMORY_QUERY_CLOSURE_V4'] : []),
        '-module-cache-path',
        cache,
        ...queryNativeSources.map((x) => join(root, 'sources', x)),
        join(root, 'sources', entry),
        '-o',
        join(root, output),
      ]);
    const manifest = schema.parse({
      schemaVersion: 1,
      protocolVersion: version,
      ...(version === 4 ? { profile: 'no_target_resources' } : {}),
      purpose: 'offline-query-candidate',
      toolchain,
      files: inventory(root),
    });
    const raw = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(join(root, 'candidate.json'), raw, { mode: 0o600, flag: 'wx' });
    return { ...reviewMemoryQueryCandidate(root, digest(raw)), runnable: false as const };
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}
