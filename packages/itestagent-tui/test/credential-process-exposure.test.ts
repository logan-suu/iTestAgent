/**
 * Credential process-exposure tests (guide §6.4).
 *
 * Contract: a secret must never be transmitted through argv, environment,
 * URL, process title, stdout/stderr, or reports. The Keychain transport is
 * stdin-only: `/usr/bin/security add-generic-password ... -w` (bare flag)
 * with the secret written to the child's stdin.
 *
 * Strategy: selectively mock node:child_process.spawn (same pattern as
 * agent-session.test.ts — non-security commands delegate to the real spawn
 * because Bun module mocks persist across test files in one process).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as childProcessReal from 'node:child_process';

// Capture REAL implementations before mock.module() below.
const realSpawn = childProcessReal.spawn;

// ─── Capture harness ────────────────────────────────────────

interface CapturedInvocation {
  command: string;
  args: string[];
  options: Record<string, unknown> | undefined;
  stdinWrites: string[];
  stdoutWrites: string[];
  stderrWrites: string[];
  killed: boolean;
}

type Script = { exitCode: number; stdout: string; stderr: string; hang?: boolean; error?: boolean };

let captured: CapturedInvocation[] = [];
let script: Script = { exitCode: 0, stdout: '', stderr: '' };

function scriptedSpawnOverride(
  command: string,
  args: readonly string[],
  options: unknown,
): unknown {
  // Selective interception: only the pinned security binary is scripted;
  // everything else must hit the real child_process (mock persistence).
  if (command !== '/usr/bin/security') {
    return realSpawn(command, args as string[], options as never);
  }
  const inv: CapturedInvocation = {
    command,
    args: [...args],
    options: options as Record<string, unknown> | undefined,
    stdinWrites: [],
    stdoutWrites: [],
    stderrWrites: [],
    killed: false,
  };
  captured.push(inv);
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const emitClose = () => {
    queueMicrotask(() => {
      listeners.get('close')?.(script.exitCode);
    });
  };
  const child = {
    stdin: {
      write: (chunk: string | Buffer) => {
        inv.stdinWrites.push(chunk.toString('utf-8'));
        return true;
      },
      end: () => {},
    },
    // Instrumented out streams: any WRITE by our module would be captured
    // (and is forbidden — the module may only READ from them).
    stdout: {
      on: (event: 'data', cb: (chunk: Buffer) => void) => {
        if (event === 'data' && script.stdout.length > 0) {
          queueMicrotask(() => cb(Buffer.from(script.stdout, 'utf-8')));
        }
      },
      write: (chunk: string | Buffer) => {
        inv.stdoutWrites.push(chunk.toString('utf-8'));
        return true;
      },
    },
    stderr: {
      on: (event: 'data', cb: (chunk: Buffer) => void) => {
        if (event === 'data' && script.stderr.length > 0) {
          queueMicrotask(() => cb(Buffer.from(script.stderr, 'utf-8')));
        }
      },
      write: (chunk: string | Buffer) => {
        inv.stderrWrites.push(chunk.toString('utf-8'));
        return true;
      },
    },
    on: (event: string, cb: (...args: unknown[]) => void) => {
      listeners.set(event, cb);
      if (event === 'error' && script.error) {
        queueMicrotask(() => cb(new Error('security spawn failed')));
      }
    },
    kill: () => {
      inv.killed = true;
      emitClose();
    },
  };
  if (!script.hang && !script.error) emitClose();
  return child;
}

mock.module('node:child_process', () => ({
  ...childProcessReal,
  spawn: scriptedSpawnOverride,
  default: { ...childProcessReal, spawn: scriptedSpawnOverride },
}));

// Dynamic import AFTER mock registration (Bun hoists static imports).
let persistence: typeof import('../src/keychain-persistence.js');
let loader: typeof import('../src/api-key-loader.js');

beforeEach(async () => {
  persistence = await import('../src/keychain-persistence.js');
  loader = await import('../src/api-key-loader.js');
  captured = [];
  script = { exitCode: 0, stdout: '', stderr: '' };
});

afterEach(() => {
  script = { exitCode: 0, stdout: '', stderr: '' };
});

// ─── Fixtures ───────────────────────────────────────────────

const SECRET = 'itestagent-fake-secret-B28-exposure-3d91ab';
const TARGET = { service: 'itestagent/openai_api_key', account: 'itestagent' };

function attributeDump(): string {
  return [
    'keychain: "/Users/fake/Library/Keychains/login.keychain-db"',
    'version: 512',
    'class: "genp"',
    'attributes:',
    `    "acct"<blob>="${TARGET.account}"`,
    `    "svce"<blob>="${TARGET.service}"`,
  ].join('\n');
}

/** Answers save's verify step with a well-formed dump; other calls succeed quietly. */
function primeSaveScript(): void {
  script = { exitCode: 0, stdout: '', stderr: '' };
  // The runner performs add first (empty output), then find (dump). The
  // override cannot distinguish per-call here, so the dump is served for the
  // find call via args inspection below instead — see next helper.
}

// The generic script serves the same stdout to every call; make the dump the
// answer for BOTH add and find (add ignores stdout, find needs the dump).
function primeDumpScript(): void {
  script = { exitCode: 0, stdout: attributeDump(), stderr: '' };
}

async function authorized() {
  const result = persistence.authorizePersistence(
    persistence.PERSISTENCE_CONFIRMATION_TOKEN,
    TARGET,
  );
  if (!result.ok) throw new Error('authorization fixture failed');
  return result.value;
}

// ─── argv exposure ──────────────────────────────────────────

describe('secret never appears in argv', () => {
  it('saveCredential: argv carries no secret and uses a bare -w flag', async () => {
    primeDumpScript();
    const result = await persistence.saveCredential(
      persistence.createSecurityRunner(),
      TARGET,
      SECRET,
      await authorized(),
    );
    expect(result.ok).toBe(true);
    const addCall = captured[0];
    expect(addCall).toBeDefined();
    const joined = addCall ? addCall.args.join(' ') : '';
    expect(joined).not.toContain(SECRET);
    // Bare -w (password read from stdin), never -w<value> / -w <value>.
    expect(addCall?.args.includes('-w')).toBe(true);
    const wIndex = addCall?.args.indexOf('-w') ?? -1;
    expect(wIndex).toBe((addCall?.args.length ?? 0) - 1);
  });

  it('loadCredential: argv contains only lookup flags', async () => {
    script = { exitCode: 0, stdout: `${SECRET}\n`, stderr: '' };
    const result = await persistence.loadCredential(persistence.createSecurityRunner(), TARGET);
    expect(result.ok).toBe(true);
    const call = captured[0];
    expect(call?.command).toBe('/usr/bin/security');
    expect(call?.args).toEqual([
      'find-generic-password',
      '-s',
      TARGET.service,
      '-a',
      TARGET.account,
      '-w',
    ]);
  });

  it('deleteCredential: argv contains no secret material', async () => {
    script = { exitCode: 0, stdout: '', stderr: '' };
    await persistence.deleteCredential(persistence.createSecurityRunner(), TARGET);
    const joined = captured[0]?.args.join(' ') ?? '';
    expect(joined).not.toContain(SECRET);
  });
});

// ─── environment exposure ───────────────────────────────────

describe('secret never appears in the environment', () => {
  it('spawn options use a minimal env allowlist without the secret', async () => {
    primeDumpScript();
    await persistence.saveCredential(
      persistence.createSecurityRunner(),
      TARGET,
      SECRET,
      await authorized(),
    );
    for (const inv of captured) {
      const env = inv.options?.env as Record<string, string> | undefined;
      expect(env).toBeDefined();
      expect(JSON.stringify(env)).not.toContain(SECRET);
      for (const key of Object.keys(env ?? {})) {
        expect(['PATH', 'HOME']).toContain(key);
      }
    }
  });

  it('ambient environment containing a like-named var is never forwarded', async () => {
    primeDumpScript();
    const previous = process.env.ITESTAGENT_FAKE_B28_VAR;
    process.env.ITESTAGENT_FAKE_B28_VAR = SECRET;
    try {
      await persistence.saveCredential(
        persistence.createSecurityRunner(),
        TARGET,
        SECRET,
        await authorized(),
      );
      for (const inv of captured) {
        const env = inv.options?.env as Record<string, string> | undefined;
        expect(Object.keys(env ?? {})).not.toContain('ITESTAGENT_FAKE_B28_VAR');
      }
    } finally {
      if (previous === undefined) process.env.ITESTAGENT_FAKE_B28_VAR = undefined;
      else process.env.ITESTAGENT_FAKE_B28_VAR = previous;
    }
  });
});

// ─── stdin / stdout / stderr transport ──────────────────────

describe('secret travels through stdin only', () => {
  it('saveCredential writes the secret to child stdin exactly once', async () => {
    primeDumpScript();
    await persistence.saveCredential(
      persistence.createSecurityRunner(),
      TARGET,
      SECRET,
      await authorized(),
    );
    const addCall = captured[0];
    expect(addCall?.stdinWrites).toEqual([SECRET]);
  });

  it('the module never writes into the child stdout/stderr channels', async () => {
    primeDumpScript();
    await persistence.saveCredential(
      persistence.createSecurityRunner(),
      TARGET,
      SECRET,
      await authorized(),
    );
    for (const inv of captured) {
      expect(inv.stdoutWrites).toHaveLength(0);
      expect(inv.stderrWrites).toHaveLength(0);
    }
  });

  it('loadCredential does not echo the retrieved value anywhere', async () => {
    script = { exitCode: 0, stdout: `${SECRET}\n`, stderr: '' };
    const result = await persistence.loadCredential(persistence.createSecurityRunner(), TARGET);
    expect(result.ok).toBe(true);
    for (const inv of captured) {
      expect(inv.stdinWrites).toHaveLength(0);
      expect(inv.stdoutWrites).toHaveLength(0);
      expect(inv.stderrWrites).toHaveLength(0);
    }
  });
});

// ─── process title & structured outputs ─────────────────────

describe('process title and structured outputs stay clean', () => {
  it('process.title is unchanged across save/load/delete', async () => {
    primeDumpScript();
    const before = process.title;
    await persistence.saveCredential(
      persistence.createSecurityRunner(),
      TARGET,
      SECRET,
      await authorized(),
    );
    script = { exitCode: 0, stdout: SECRET, stderr: '' };
    await persistence.loadCredential(persistence.createSecurityRunner(), TARGET);
    script = { exitCode: 0, stdout: '', stderr: '' };
    await persistence.deleteCredential(persistence.createSecurityRunner(), TARGET);
    expect(process.title).toBe(before);
  });

  it('error results never embed the secret in their message payload', async () => {
    script = { exitCode: 1, stdout: '', stderr: 'security: SecKeychainSearch' };
    const loadResult = await persistence.loadCredential(persistence.createSecurityRunner(), TARGET);
    expect(loadResult.ok).toBe(false);
    if (!loadResult.ok) {
      expect(JSON.stringify(loadResult.error)).not.toContain(SECRET);
    }

    primeSaveScript();
    script = { exitCode: 1, stdout: '', stderr: 'add failed' };
    const saveResult = await persistence.saveCredential(
      persistence.createSecurityRunner(),
      TARGET,
      SECRET,
      await authorized(),
    );
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(JSON.stringify(saveResult.error)).not.toContain(SECRET);
    }
  });

  it('loader-level failure output contains no secret bytes', async () => {
    const plaintext = JSON.stringify({ apiKey: SECRET });
    const result = await loader.loadApiKey({
      configReader: () => plaintext,
      keychainLoader: () =>
        Promise.resolve(persistence.err({ code: 'item_not_found', message: 'missing' })),
      configPath: '/tmp/does-not-matter.jsonc',
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('timeout path kills the child and reports timeout without leaking the secret', async () => {
    script = { exitCode: 0, stdout: '', stderr: '', hang: true };
    const result = await persistence.loadCredential(
      persistence.createSecurityRunner({ defaultTimeoutMs: 40 }),
      TARGET,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
      expect(JSON.stringify(result.error)).not.toContain(SECRET);
    }
    expect(captured[0]?.killed).toBe(true);
  });
});
