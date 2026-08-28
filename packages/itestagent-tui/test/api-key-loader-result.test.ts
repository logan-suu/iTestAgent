/**
 * API key loader Result<T,E> contract tests (guide §6.4).
 *
 * Contract points covered here:
 *   - The loader never throws: every failure is a typed Err result.
 *   - Reading failure must NOT fall back to a plaintext file.
 *   - Inline plaintext API keys inside the config file are rejected
 *     fail-closed (never used, never returned).
 *   - A config file may only carry a Keychain *pointer* (service/account),
 *     never the secret itself.
 */
import { describe, expect, it } from 'bun:test';
import {
  type ApiKeyLoaderDeps,
  DEFAULT_API_KEY_TARGET,
  loadApiKey,
} from '../src/api-key-loader.js';
import { type KeychainError, type KeychainTarget, err, ok } from '../src/keychain-persistence.js';

// ─── Test helpers ───────────────────────────────────────────

const FAKE_KEY = 'itestagent-fake-key-B28-loader-41c7';

function keychainOk(value: string) {
  return Promise.resolve(ok(value));
}

function keychainErr(code: KeychainError['code'], message: string) {
  return Promise.resolve(err({ code, message } satisfies KeychainError));
}

function makeDeps(overrides: Partial<ApiKeyLoaderDeps> = {}): ApiKeyLoaderDeps {
  return {
    configReader: () => null,
    keychainLoader: () => keychainOk(FAKE_KEY),
    ...overrides,
  };
}

// ─── Happy path ─────────────────────────────────────────────

describe('loadApiKey happy path', () => {
  it('returns Ok with source "keychain" when the Keychain read succeeds', async () => {
    const result = await loadApiKey(makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe(FAKE_KEY);
    expect(result.value.source).toBe('keychain');
    expect(result.value.target).toEqual(DEFAULT_API_KEY_TARGET);
  });

  it('trims surrounding whitespace from the Keychain value', async () => {
    const result = await loadApiKey(
      makeDeps({ keychainLoader: () => keychainOk(`  ${FAKE_KEY}\n`) }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.value).toBe(FAKE_KEY);
  });

  it('uses the default Keychain target when no config file exists', async () => {
    let seenTarget: KeychainTarget | undefined;
    await loadApiKey(
      makeDeps({
        keychainLoader: (target) => {
          seenTarget = target;
          return keychainOk(FAKE_KEY);
        },
      }),
    );
    expect(seenTarget).toEqual(DEFAULT_API_KEY_TARGET);
  });

  it('honors a config Keychain pointer (service/account override)', async () => {
    const config = JSON.stringify({
      model: {
        apiKeySource: { type: 'keychain', service: 'custom/svc-B28', account: 'custom-acct' },
      },
    });
    let seenTarget: KeychainTarget | undefined;
    const result = await loadApiKey(
      makeDeps({
        configReader: () => config,
        keychainLoader: (target) => {
          seenTarget = target;
          return keychainOk(FAKE_KEY);
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(seenTarget).toEqual({ service: 'custom/svc-B28', account: 'custom-acct' });
  });
});

// ─── Failure paths are typed Err results (never thrown) ─────

describe('loadApiKey failure paths', () => {
  it('returns Err (not a throw) when the Keychain item is missing', async () => {
    const result = await loadApiKey(
      makeDeps({ keychainLoader: () => keychainErr('item_not_found', 'not found') }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('keychain_read_failed');
  });

  it('wraps the underlying Keychain error detail', async () => {
    const result = await loadApiKey(
      makeDeps({ keychainLoader: () => keychainErr('denied_by_user', 'denied') }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('keychain_read_failed');
    expect(result.error.detail?.code).toBe('denied_by_user');
  });

  it('maps a whitespace-only Keychain value to empty_value', async () => {
    const result = await loadApiKey(makeDeps({ keychainLoader: () => keychainOk('   ') }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('empty_value');
  });
});

// ─── No plaintext fallback (guide §6.4 hard rule) ───────────

describe('loadApiKey never falls back to plaintext', () => {
  it('does NOT read a plaintext key from config when the Keychain read fails', async () => {
    const plaintextConfig = JSON.stringify({ apiKey: FAKE_KEY });
    let configReads = 0;
    const result = await loadApiKey(
      makeDeps({
        configReader: () => {
          configReads += 1;
          return plaintextConfig;
        },
        keychainLoader: () => keychainErr('item_not_found', 'missing'),
      }),
    );
    // The config was consulted (to detect the contract violation)...
    expect(configReads).toBe(1);
    // ...but the plaintext value must NEVER be surfaced as a success.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).not.toContain(FAKE_KEY);
  });

  it('rejects an inline top-level apiKey even when the Keychain would succeed', async () => {
    let keychainCalls = 0;
    const result = await loadApiKey(
      makeDeps({
        configReader: () => JSON.stringify({ apiKey: FAKE_KEY }),
        keychainLoader: () => {
          keychainCalls += 1;
          return keychainOk(FAKE_KEY);
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('plaintext_config_rejected');
    // Fail-closed: the Keychain is not even consulted once plaintext is detected.
    expect(keychainCalls).toBe(0);
  });

  it('rejects nested model.apiKey as inline plaintext', async () => {
    const result = await loadApiKey(
      makeDeps({ configReader: () => JSON.stringify({ model: { apiKey: FAKE_KEY } }) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('plaintext_config_rejected');
  });

  it('rejects snake_case api_key variants as inline plaintext', async () => {
    for (const cfg of [
      JSON.stringify({ api_key: FAKE_KEY }),
      JSON.stringify({ model: { api_key: FAKE_KEY } }),
    ]) {
      const result = await loadApiKey(makeDeps({ configReader: () => cfg }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('plaintext_config_rejected');
      }
    }
  });

  it('error output for plaintext rejection contains no secret bytes', async () => {
    const result = await loadApiKey(
      makeDeps({ configReader: () => JSON.stringify({ apiKey: FAKE_KEY }) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });
});

// ─── Robustness ─────────────────────────────────────────────

describe('loadApiKey robustness', () => {
  it('treats an unreadable config file as absent (defaults apply)', async () => {
    const result = await loadApiKey(
      makeDeps({
        configReader: () => {
          throw new Error('EACCES');
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('treats malformed config content as absent rather than crashing', async () => {
    const result = await loadApiKey(makeDeps({ configReader: () => '{{{ not jsonc at all }}]' }));
    expect(result.ok).toBe(true);
  });

  it('ignores a pointer with an unsupported type and keeps the default target', async () => {
    let seenTarget: KeychainTarget | undefined;
    const result = await loadApiKey(
      makeDeps({
        configReader: () =>
          JSON.stringify({ model: { apiKeySource: { type: 'plaintext-file', path: '/x' } } }),
        keychainLoader: (target) => {
          seenTarget = target;
          return keychainOk(FAKE_KEY);
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(seenTarget).toEqual(DEFAULT_API_KEY_TARGET);
  });

  it('both Result variants are structurally discriminable via the ok discriminator', async () => {
    const good = await loadApiKey(makeDeps());
    const bad = await loadApiKey(
      makeDeps({ keychainLoader: () => keychainErr('timeout', 'timed out') }),
    );
    expect(good.ok).toBe(true);
    expect(bad.ok).toBe(false);
  });
});
