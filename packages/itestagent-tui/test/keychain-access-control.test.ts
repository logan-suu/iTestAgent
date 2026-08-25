/**
 * Keychain access-control tests (guide §6.4).
 *
 * Contract: the Keychain item must use non-sync, device-local,
 * when-unlocked access control; a read failure must NOT fall back to a
 * plaintext file.
 */
import { describe, expect, it } from 'bun:test';
import { loadApiKey } from '../src/api-key-loader.js';
import {
  KEYCHAIN_ACCESS_CONTROL,
  type KeychainError,
  type KeychainTarget,
  PERSISTENCE_CONFIRMATION_TOKEN,
  type SecurityRunResult,
  type SecurityRunner,
  authorizePersistence,
  describeAccessControl,
  loadCredential,
  saveCredential,
  verifyAccessControl,
} from '../src/keychain-persistence.js';

const TARGET: KeychainTarget = { service: 'itestagent/openai_api_key', account: 'itestagent' };
const SECRET = 'itestagent-fake-secret-B28-acl-5e02';

// ─── Access-control attribute contract ──────────────────────

describe('KEYCHAIN_ACCESS_CONTROL attributes', () => {
  it('is non-synchronizable (device-local only)', () => {
    expect(KEYCHAIN_ACCESS_CONTROL.synchronizable).toBe(false);
  });

  it('is device-local', () => {
    expect(KEYCHAIN_ACCESS_CONTROL.deviceLocal).toBe(true);
  });

  it('is readable only when unlocked', () => {
    expect(KEYCHAIN_ACCESS_CONTROL.accessible).toBe('when-unlocked');
  });

  it('is frozen (cannot be loosened at runtime)', () => {
    expect(Object.isFrozen(KEYCHAIN_ACCESS_CONTROL)).toBe(true);
  });
});

describe('describeAccessControl', () => {
  it('mentions all three required properties', () => {
    const lines = describeAccessControl().join('\n');
    expect(lines).toContain('non-sync');
    expect(lines).toContain('device-local');
    expect(lines).toContain('when-unlocked');
  });

  it('matches the frozen constants (no drift)', () => {
    const lines = describeAccessControl().join('\n');
    if (!KEYCHAIN_ACCESS_CONTROL.synchronizable) expect(lines).toContain('non-sync');
    if (KEYCHAIN_ACCESS_CONTROL.deviceLocal) expect(lines).toContain('device-local');
    expect(lines).toContain(KEYCHAIN_ACCESS_CONTROL.accessible);
  });
});

// ─── Attribute verification against CLI dump ────────────────

function runnerWithDump(dump: string | null): SecurityRunner {
  return {
    async run(): Promise<SecurityRunResult> {
      if (dump === null) {
        return { exitCode: 44, stdout: '', stderr: 'not found', timedOut: false };
      }
      return { exitCode: 0, stdout: dump, stderr: '', timedOut: false };
    },
  };
}

function wellFormedDump(target: KeychainTarget): string {
  return [
    'keychain: "/Users/fake/Library/Keychains/login.keychain-db"',
    'version: 512',
    'class: "genp"',
    'attributes:',
    `    "acct"<blob>="${target.account}"`,
    `    "svce"<blob>="${target.service}"`,
  ].join('\n');
}

describe('verifyAccessControl', () => {
  it('accepts a well-formed generic-password dump matching the target', async () => {
    const result = await verifyAccessControl(runnerWithDump(wellFormedDump(TARGET)), TARGET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.synchronizable).toBe(false);
      expect(result.value.deviceLocal).toBe(true);
      expect(result.value.accessible).toBe('when-unlocked');
    }
  });

  it('fails closed on a mismatched service attribute', async () => {
    const dump = wellFormedDump({ service: 'other/svc', account: TARGET.account });
    const result = await verifyAccessControl(runnerWithDump(dump), TARGET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('verification_failed');
    }
  });

  it('fails closed on a mismatched account attribute', async () => {
    const dump = wellFormedDump({ service: TARGET.service, account: 'someone-else' });
    const result = await verifyAccessControl(runnerWithDump(dump), TARGET);
    expect(result.ok).toBe(false);
  });

  it('fails closed when the item class is not a generic password', async () => {
    const dump = wellFormedDump(TARGET).replace('class: "genp"', 'class: "inet"');
    const result = await verifyAccessControl(runnerWithDump(dump), TARGET);
    expect(result.ok).toBe(false);
  });

  it('fails closed on unparseable output', async () => {
    const result = await verifyAccessControl(runnerWithDump('garbage ==='), TARGET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('verification_failed');
    }
  });

  it('fails closed when the item is missing', async () => {
    const result = await verifyAccessControl(runnerWithDump(null), TARGET);
    expect(result.ok).toBe(false);
  });
});

// ─── No plaintext fallback (guide §6.4 hard rule) ───────────

describe('no plaintext fallback after Keychain failure', () => {
  it('loadCredential returns an error and never reads any file', async () => {
    // Runner simulates total Keychain failure for every call.
    const failing: SecurityRunner = {
      async run(): Promise<SecurityRunResult> {
        return { exitCode: 44, stdout: '', stderr: 'not found', timedOut: false };
      },
    };
    const result = await loadCredential(failing, TARGET);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['item_not_found', 'keychain_read_failed']).toContain(result.error.code);
    }
  });

  it('loader refuses plaintext config content even with the Keychain broken', async () => {
    const plaintextConfig = JSON.stringify({ apiKey: SECRET });
    const result = await loadApiKey({
      configReader: () => plaintextConfig,
      keychainLoader: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'item_not_found', message: 'missing' } as KeychainError,
        }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('plaintext_config_rejected');
    }
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('a failed save never offers a plaintext file destination', async () => {
    const failing: SecurityRunner = {
      async run(): Promise<SecurityRunResult> {
        return { exitCode: 45, stdout: '', stderr: 'denied', timedOut: false };
      },
    };
    const auth = authorizePersistence(PERSISTENCE_CONFIRMATION_TOKEN, TARGET);
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    const result = await saveCredential(failing, TARGET, SECRET, auth.value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The error must not suggest or reference a plaintext fallback path.
      expect(JSON.stringify(result.error).toLowerCase()).not.toContain('file');
    }
  });
});
