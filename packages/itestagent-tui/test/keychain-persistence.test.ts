/**
 * Keychain persistence round-trip tests (guide §6.4).
 *
 * Exercises save/load/delete against a fake `/usr/bin/security` runner
 * backed by an in-memory store — no real Keychain access in tests.
 */
import { describe, expect, it } from 'bun:test';
import {
  type KeychainError,
  type KeychainTarget,
  PERSISTENCE_CONFIRMATION_TOKEN,
  type SecurityRunResult,
  type SecurityRunner,
  authorizePersistence,
  deleteCredential,
  loadCredential,
  saveCredential,
} from '../src/keychain-persistence.js';

// ─── Fake security CLI ──────────────────────────────────────

const TARGET: KeychainTarget = { service: 'itestagent/openai_api_key', account: 'itestagent' };
const SECRET_A = 'itestagent-fake-secret-B28-aaaa';
const SECRET_B = 'itestagent-fake-secret-B28-bbbb';

function attributeDump(target: KeychainTarget): string {
  return [
    'keychain: "/Users/fake/Library/Keychains/login.keychain-db"',
    'version: 512',
    'class: "genp"',
    'attributes:',
    `    "acct"<blob>="${target.account}"`,
    `    "svce"<blob>="${target.service}"`,
    '    "cdat"<timedate>="2026-01-01 00:00:00 +0000"',
  ].join('\n');
}

interface FakeCall {
  args: string[];
  stdin: string | undefined;
}

type FakeBehavior = (args: string[], stdin: string | undefined) => SecurityRunResult;

function fakeRunner(behavior: FakeBehavior): SecurityRunner & { calls: FakeCall[] } {
  return {
    calls: [],
    async run(args: readonly string[], options?: { stdin?: string }): Promise<SecurityRunResult> {
      const list = args as string[];
      this.calls.push({ args: list, stdin: options?.stdin });
      return behavior(list, options?.stdin);
    },
  };
}

/** In-memory keychain store simulating add/find/delete semantics of the CLI. */
function storeRunner(store: Map<string, string>, dumpOk = true) {
  return fakeRunner((args, stdin) => {
    const verb = args[0];
    const svcIdx = args.indexOf('-s');
    const acctIdx = args.indexOf('-a');
    const service = svcIdx >= 0 ? (args[svcIdx + 1] ?? '') : '';
    const account = acctIdx >= 0 ? (args[acctIdx + 1] ?? '') : '';
    const key = `${service}|${account}`;
    switch (verb) {
      case 'add-generic-password': {
        // Bare -w: password arrives via stdin.
        if (stdin === undefined) {
          return { exitCode: 45, stdout: '', stderr: 'password required', timedOut: false };
        }
        store.set(key, stdin);
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      }
      case 'find-generic-password': {
        if (!args.includes('-w')) {
          if (!dumpOk || !store.has(key)) {
            return { exitCode: 44, stdout: '', stderr: 'not found', timedOut: false };
          }
          return {
            exitCode: 0,
            stdout: attributeDump({ service, account }),
            stderr: '',
            timedOut: false,
          };
        }
        const value = store.get(key);
        if (value === undefined) {
          return { exitCode: 44, stdout: '', stderr: 'not found', timedOut: false };
        }
        return { exitCode: 0, stdout: `${value}\n`, stderr: '', timedOut: false };
      }
      case 'delete-generic-password': {
        if (!store.has(key)) {
          return { exitCode: 44, stdout: '', stderr: 'not found', timedOut: false };
        }
        store.delete(key);
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      }
      default:
        return { exitCode: 1, stdout: '', stderr: `unknown verb ${String(verb)}`, timedOut: false };
    }
  });
}

function authorized(target: KeychainTarget = TARGET) {
  const result = authorizePersistence(PERSISTENCE_CONFIRMATION_TOKEN, target);
  if (!result.ok) throw new Error('authorization fixture failed');
  return result.value;
}

function errCode(result: { ok: boolean; error?: KeychainError }): string {
  return result.ok ? '<ok>' : (result.error?.code ?? '<none>');
}

// ─── Round trip ─────────────────────────────────────────────

describe('save/load/delete round trip', () => {
  it('saves, loads back the identical value, then deletes', async () => {
    const store = new Map<string, string>();
    const runner = storeRunner(store);

    const saved = await saveCredential(runner, TARGET, SECRET_A, authorized());
    expect(saved.ok).toBe(true);

    const loaded = await loadCredential(runner, TARGET);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toBe(SECRET_A);
    }

    const removed = await deleteCredential(runner, TARGET);
    expect(removed.ok).toBe(true);

    const reloaded = await loadCredential(runner, TARGET);
    expect(errCode(reloaded)).toBe('item_not_found');
  });

  it('overwrite (-U semantics): a second authorized save replaces the value', async () => {
    const store = new Map<string, string>();
    const runner = storeRunner(store);

    await saveCredential(runner, TARGET, SECRET_A, authorized());
    await saveCredential(runner, TARGET, SECRET_B, authorized());

    const loaded = await loadCredential(runner, TARGET);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toBe(SECRET_B);
    }
  });

  it('load trims the trailing newline emitted by the CLI', async () => {
    const store = new Map<string, string>([[`${TARGET.service}|${TARGET.account}`, SECRET_A]]);
    const runner = storeRunner(store);
    const loaded = await loadCredential(runner, TARGET);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toBe(SECRET_A);
    }
  });
});

// ─── Failure mapping (fail-closed) ──────────────────────────

describe('failure mapping', () => {
  it('missing item on load maps to item_not_found (exit 44)', async () => {
    const runner = storeRunner(new Map());
    const result = await loadCredential(runner, TARGET);
    expect(errCode(result)).toBe('item_not_found');
  });

  it('deleting a nonexistent item maps to item_not_found (no silent success)', async () => {
    const runner = storeRunner(new Map());
    const result = await deleteCredential(runner, TARGET);
    expect(errCode(result)).toBe('item_not_found');
  });

  it('user denial maps to denied_by_user (exit 45)', async () => {
    const runner = fakeRunner(() => ({
      exitCode: 45,
      stdout: '',
      stderr: 'User interaction is not allowed.',
      timedOut: false,
    }));
    const result = await loadCredential(runner, TARGET);
    expect(errCode(result)).toBe('denied_by_user');
  });

  it('unexpected exit codes map to unexpected_exit carrying the code', async () => {
    const runner = fakeRunner(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: false,
    }));
    const result = await loadCredential(runner, TARGET);
    expect(errCode(result)).toBe('unexpected_exit');
    if (!result.ok) {
      expect(result.error.message).toContain('1');
    }
  });

  it('timed-out runs map to timeout', async () => {
    const runner = fakeRunner(() => ({
      exitCode: null as unknown as number,
      stdout: '',
      stderr: '',
      timedOut: true,
    }));
    const result = await loadCredential(runner, TARGET);
    expect(errCode(result)).toBe('timeout');
  });

  it('an empty stored value maps to empty_value instead of Ok("")', async () => {
    const store = new Map<string, string>([[`${TARGET.service}|${TARGET.account}`, '   ']]);
    const result = await loadCredential(storeRunner(store), TARGET);
    expect(errCode(result)).toBe('empty_value');
  });

  it('saving an empty value is rejected before any process spawn', async () => {
    const runner = storeRunner(new Map());
    const result = await saveCredential(runner, TARGET, '   ', authorized());
    expect(errCode(result)).toBe('empty_value');
    expect(runner.calls).toHaveLength(0);
  });
});

// ─── Save verification (fail-closed write path) ─────────────

describe('post-write verification', () => {
  it('save fails closed when the attribute verification cannot confirm the item', async () => {
    // Store works, but attribute dumps are refused → verify step fails.
    const store = new Map<string, string>();
    const runner = storeRunner(store, false);
    const result = await saveCredential(runner, TARGET, SECRET_A, authorized());
    expect(errCode(result)).toBe('verification_failed');
  });

  it('save fails closed when the dump shows a mismatched service', async () => {
    const wrongTarget: KeychainTarget = { service: 'other/svc', account: TARGET.account };
    const runner = fakeRunner((args) => {
      if (args.includes('find-generic-password') && !args.includes('-w')) {
        return {
          exitCode: 0,
          stdout: attributeDump(wrongTarget),
          stderr: '',
          timedOut: false,
        };
      }
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    });
    const result = await saveCredential(runner, TARGET, SECRET_A, authorized());
    expect(errCode(result)).toBe('verification_failed');
  });
});

// ─── Transport discipline inside the happy path ─────────────

describe('transport discipline', () => {
  it('add-generic-password receives the secret via stdin with a bare trailing -w', async () => {
    const store = new Map<string, string>();
    const runner = storeRunner(store);
    await saveCredential(runner, TARGET, SECRET_A, authorized());

    const add = runner.calls.find((c) => c.args[0] === 'add-generic-password');
    expect(add).toBeDefined();
    expect(add?.args.at(-1)).toBe('-w');
    expect(add?.stdin).toBe(SECRET_A);
    expect(add?.args.join(' ')).not.toContain(SECRET_A);
  });

  it('attribute verification never requests the password (-w absent)', async () => {
    const store = new Map<string, string>();
    const runner = storeRunner(store);
    await saveCredential(runner, TARGET, SECRET_A, authorized());

    const verify = runner.calls.find(
      (c) => c.args[0] === 'find-generic-password' && !c.args.includes('-w'),
    );
    expect(verify).toBeDefined();
    expect(verify?.stdin).toBeUndefined();
  });
});
