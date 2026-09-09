import { randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { type HelperInstallInput, resolveMemoryAppLaunch } from './xcode-memory-helper-install.js';
import { parseXcodeMemoryPreflight } from './xcode-memory-preflight.js';

type LaunchOutput = { stdout: string; stderr: string; exitCode: number; interrupted: boolean };
type Spawn = (
  args: string[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
) => Promise<LaunchOutput>;

/** The launcher's stdin is a lifetime pipe. Give its cleanup deadline priority over SIGKILL. */
export const startMemoryAppLauncher: Spawn = async (args, signal, timeoutMs) => {
  const child = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let interrupted = false;
  let kill: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (interrupted) return;
    interrupted = true;
    child.stdin.end();
    kill = setTimeout(() => child.kill('SIGKILL'), 7000);
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timeout = setTimeout(stop, timeoutMs + 1000);
  async function drain(stream: ReadableStream<Uint8Array>) {
    let text = '';
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text;
        if (text.length + value.length > 16384) {
          stop();
          continue;
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      drain(child.stdout),
      drain(child.stderr),
      child.exited,
    ]);
    return { stdout, stderr, exitCode, interrupted };
  } catch {
    stop();
    await child.exited;
    throw new Error('launcher.transport_failed');
  } finally {
    clearTimeout(timeout);
    clearTimeout(kill);
    signal?.removeEventListener('abort', stop);
    child.stdin.end();
  }
};

function privateRoot(path: string) {
  if (resolve(path) !== path || realpathSync(path) !== path) throw new Error('invalid_root');
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
    throw new Error('invalid_root');
}
function readResult(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size > 2048 ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error('invalid_result');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally {
    closeSync(fd);
  }
}
function lifecycle(raw: string, requestId: string) {
  const events = raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  if (events.length < 1 || events.length > 3) throw new Error('invalid_lifecycle');
  for (const event of events) {
    if (
      event.protocolVersion !== 1 ||
      event.requestId !== requestId ||
      Object.keys(event).some(
        (k) =>
          ![
            'protocolVersion',
            'requestId',
            'event',
            'pid',
            'reason',
            'cleanupVerified',
            'terminatedAtCallback',
          ].includes(k),
      )
    )
      throw new Error('invalid_lifecycle');
  }
  const last = events.at(-1);
  if (
    last?.event !== 'closed' ||
    last.cleanupVerified !== true ||
    !['completed', 'cancelled', 'timeout', 'launch_failed', 'instance_conflict'].includes(
      last.reason,
    )
  )
    throw new Error('cleanup_unverified');
  const prefix = events.slice(0, -1);
  if (prefix.length && prefix[0]?.event !== 'launch_requested')
    throw new Error('invalid_lifecycle');
  if (
    prefix.length === 2 &&
    (prefix[1]?.event !== 'launched' ||
      !(
        (Number.isSafeInteger(prefix[1]?.pid) &&
          prefix[1].pid > 0 &&
          prefix[1].terminatedAtCallback === undefined) ||
        (prefix[1]?.terminatedAtCallback === true && prefix[1].pid === undefined)
      ))
  )
    throw new Error('invalid_lifecycle');
  if (last.reason === 'completed' && prefix.length !== 2) throw new Error('invalid_lifecycle');
  return last.reason as string;
}

/** No UI automation is accepted unless both a bound result and verified owner exit exist. */
export async function preflightMemoryApp(
  input: HelperInstallInput & { requestRoot: string; timeoutMs?: number },
  deps: { resolve?: typeof resolveMemoryAppLaunch; spawn?: Spawn } = {},
) {
  const blocked = (reason: string, cleanupVerified: boolean) => ({
    status: 'blocked' as const,
    reason,
    targetVerified: false as const,
    cleanupVerified,
  });
  if (input.signal?.aborted) return blocked('cancelled', true);
  const timeoutMs = input.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    return blocked('invalid_input', true);
  let lock: string | undefined;
  let directory: string | undefined;
  let cleanupVerified = true;
  try {
    const paths = await (deps.resolve ?? resolveMemoryAppLaunch)(input);
    privateRoot(input.requestRoot);
    privateRoot(input.root);
    lock = join(input.root, 'memory-app.lock');
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch {
      lock = undefined;
      return blocked('instance_conflict', true);
    }
    const requestId = randomUUID();
    directory = join(input.requestRoot, `memory-request-${requestId}`);
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ requestId, protocolVersion: 1 }), {
      flag: 'wx',
      mode: 0o600,
    });
    if (input.signal?.aborted) return blocked('cancelled', true);
    cleanupVerified = false;
    const result = await (deps.spawn ?? startMemoryAppLauncher)(
      [paths.launcherPath, paths.appPath, requestId, directory, input.xcodePath, String(timeoutMs)],
      input.signal,
      timeoutMs,
    );
    const reason = lifecycle(result.stdout, requestId);
    cleanupVerified = true;
    if (input.signal?.aborted || result.interrupted) return blocked('cancelled', true);
    if (result.exitCode !== 0 || result.stderr !== '') return blocked('launch_failed', true);
    if (reason !== 'completed') return blocked(reason, true);
    const value = readResult(join(directory, 'result.json'));
    if (value.requestId !== requestId) return blocked('result_invalid', true);
    value.requestId = undefined;
    const parsed = parseXcodeMemoryPreflight(JSON.stringify(value));
    return { ...parsed, cleanupVerified: true };
  } catch {
    return blocked(
      cleanupVerified ? 'result_or_installation_invalid' : 'cleanup_unverified',
      cleanupVerified,
    );
  } finally {
    // An unresolved launch retains its lease and evidence; it cannot be silently retried.
    if (cleanupVerified) {
      if (directory) rmSync(directory, { recursive: true, force: true });
      if (lock) rmSync(lock, { recursive: true, force: true });
    }
  }
}
