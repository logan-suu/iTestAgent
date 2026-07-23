import { describe, expect, it } from 'bun:test';
import type { CredentialRequest, SecretStore } from 'itestagent-contracts';
import { CredentialManager } from '../src/test-data/credential-manager.js';

// ─── In-memory SecretStore for tests ────────────────────────
// Avoids cross-package dependency on itestagent-cli.

class TestSecretStore implements SecretStore {
  #store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.#store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.#store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#store.delete(key);
  }

  get size(): number {
    return this.#store.size;
  }
}

// ─── Helpers ────────────────────────────────────────────────

type PromptCallback = (
  req: CredentialRequest,
) => Promise<{ status: 'provided' | 'skipped'; value?: string; remembered?: boolean }>;

function makePromptCallback(
  responses: Record<string, { value: string; remembered?: boolean }>,
): PromptCallback {
  return async (req) => {
    const resp = responses[req.key];
    if (!resp) {
      return { status: 'skipped' };
    }
    return { status: 'provided', value: resp.value, remembered: resp.remembered };
  };
}

function makeSkipCallback(): PromptCallback {
  return async () => ({ status: 'skipped' });
}

function makeRequest(overrides?: Partial<CredentialRequest>): CredentialRequest {
  return {
    key: 'test_key',
    label: 'Test Credential',
    kind: 'text',
    required: true,
    helpText: 'Enter your test credential',
    ...overrides,
  };
}

function isIso8601(str: string): boolean {
  return !Number.isNaN(Date.parse(str)) && str.includes('T');
}

// ────────────────────────────────────────────────────────────
//  US-10.2: CredentialManager
// ────────────────────────────────────────────────────────────

describe('CredentialManager — US-10.2', () => {
  // ─── AC1: Resolve from memory store ────────────────────────────

  describe('resolveCredential — memory store', () => {
    it('resolves credential from memory store when available', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(memStore);

      await memStore.set('login_user', 'test_user_123');

      const result = await manager.resolveCredential(
        makeRequest({ key: 'login_user', label: 'Username' }),
      );
      expect(result.status).toBe('found');
      expect(result.entry).toBeDefined();
      expect(result.entry?.value).toBe('test_user_123');
      expect(result.entry?.key).toBe('login_user');
    });

    it('returns found status with correct entry shape', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(memStore);

      await memStore.set('api_token', 'sk-test-token-12345');

      const result = await manager.resolveCredential(
        makeRequest({ key: 'api_token', kind: 'token', label: 'API Token' }),
      );
      expect(result.status).toBe('found');
      expect(result.entry?.key).toBe('api_token');
      expect(result.entry?.value).toBe('sk-test-token-12345');
      expect(result.entry?.kind).toBe('token');
      expect(result.entry?.sessionOnly).toBe(true);
      expect(typeof result.entry?.storedAt === 'string' && isIso8601(result.entry.storedAt)).toBe(true);
    });
  });

  // ─── AC1: Resolve from keychain store (fallback) ───────────────

  describe('resolveCredential — keychain fallback', () => {
    it('falls back to keychain store when memory store has no entry', async () => {
      const memStore = new TestSecretStore();
      const keychainStore = new TestSecretStore();
      const manager = new CredentialManager(memStore, keychainStore);

      await keychainStore.set('saved_password', 'my-secret-pw');

      const result = await manager.resolveCredential(
        makeRequest({ key: 'saved_password', kind: 'password', label: 'Password' }),
      );
      expect(result.status).toBe('found');
      expect(result.entry?.value).toBe('my-secret-pw');
      // Loaded from keychain into memory — entry is still sessionOnly=true (not persisted to disk)
    });

    it('memory store takes priority over keychain store', async () => {
      const memStore = new TestSecretStore();
      const keychainStore = new TestSecretStore();
      const manager = new CredentialManager(memStore, keychainStore);

      await memStore.set('shared_key', 'memory_value');
      await keychainStore.set('shared_key', 'keychain_value');

      const result = await manager.resolveCredential(makeRequest({ key: 'shared_key' }));
      expect(result.status).toBe('found');
      expect(result.entry?.value).toBe('memory_value');
    });
  });

  // ─── AC1-AC2: Prompt callback ──────────────────────────────────

  describe('resolveCredential — prompt callback', () => {
    it('prompts user when credential not in memory or keychain', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(
        memStore,
        undefined,
        makePromptCallback({ new_cred: { value: 'user_input_value' } }),
      );

      const result = await manager.resolveCredential(
        makeRequest({ key: 'new_cred', label: 'New Credential' }),
      );
      expect(result.status).toBe('prompted');
      expect(result.entry?.value).toBe('user_input_value');
    });

    it('stores prompted credential to memory for session reuse', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(
        memStore,
        undefined,
        makePromptCallback({ fresh_cred: { value: 'fresh_session_value' } }),
      );

      await manager.resolveCredential(makeRequest({ key: 'fresh_cred', label: 'Fresh' }));

      // Second resolve should hit memory store, not prompt again
      const result = await manager.resolveCredential(
        makeRequest({ key: 'fresh_cred', label: 'Fresh' }),
      );
      expect(result.status).toBe('found');
      expect(result.entry?.value).toBe('fresh_session_value');
    });
  });

  // ─── AC3: Remember to keychain ─────────────────────────────────

  describe('resolveCredential — remember to keychain', () => {
    it('stores to keychain when remembered=true', async () => {
      const memStore = new TestSecretStore();
      const keychainStore = new TestSecretStore();
      const manager = new CredentialManager(
        memStore,
        keychainStore,
        makePromptCallback({ persisted_cred: { value: 'persisted_val', remembered: true } }),
      );

      await manager.resolveCredential(makeRequest({ key: 'persisted_cred', label: 'Persisted' }));

      const keychainVal = await keychainStore.get('persisted_cred');
      expect(keychainVal).toBe('persisted_val');
    });

    it('does NOT store to keychain when remembered is false', async () => {
      const memStore = new TestSecretStore();
      const keychainStore = new TestSecretStore();
      const manager = new CredentialManager(
        memStore,
        keychainStore,
        makePromptCallback({ temp_cred: { value: 'temp_val', remembered: false } }),
      );

      await manager.resolveCredential(makeRequest({ key: 'temp_cred', label: 'Temp' }));

      const keychainVal = await keychainStore.get('temp_cred');
      expect(keychainVal).toBeNull();
    });
  });

  // ─── AC5: Skip behavior ────────────────────────────────────────

  describe('resolveCredential — skip behavior (AC5)', () => {
    it('returns status=skipped when user skips and required=false', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(memStore, undefined, makeSkipCallback());

      const result = await manager.resolveCredential(
        makeRequest({ key: 'optional_login', required: false, label: 'Optional Login' }),
      );
      expect(result.status).toBe('skipped');
      expect(result.entry).toBeUndefined();
    });

    it('returns status=skipped when user skips required credential', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(memStore, undefined, makeSkipCallback());

      const result = await manager.resolveCredential(
        makeRequest({ key: 'required_login', required: true, label: 'Required Login' }),
      );
      // Even when required, user can still skip — status reflects user choice
      expect(result.status).toBe('skipped');
    });
  });

  // ─── No prompt callback fallback ───────────────────────────────

  describe('resolveCredential — no prompt callback', () => {
    it('returns not_found when no stores have entry and no callback', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(memStore);

      const result = await manager.resolveCredential(makeRequest({ key: 'missing_cred' }));
      expect(result.status).toBe('not_found');
      expect(result.entry).toBeUndefined();
    });
  });

  // ─── Batch resolve ─────────────────────────────────────────────

  describe('resolveCredentials — batch', () => {
    it('resolves multiple credentials in batch', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(
        memStore,
        undefined,
        makePromptCallback({
          prompted_cred: { value: 'from_prompt' },
        }),
      );

      await memStore.set('cached_cred', 'from_cache');

      const results = await manager.resolveCredentials([
        makeRequest({ key: 'cached_cred', label: 'Cached' }),
        makeRequest({ key: 'prompted_cred', label: 'Prompted' }),
        makeRequest({ key: 'missing_no_cb', label: 'Missing' }),
      ]);

      expect(results.size).toBe(3);
      expect(results.get('cached_cred')?.status).toBe('found');
      expect(results.get('cached_cred')?.entry?.value).toBe('from_cache');
      expect(results.get('prompted_cred')?.status).toBe('prompted');
      expect(results.get('prompted_cred')?.entry?.value).toBe('from_prompt');
      expect(results.get('missing_no_cb')?.status).toBe('skipped');
    });

    it('returns empty map for empty request array', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(memStore);
      const results = await manager.resolveCredentials([]);
      expect(results.size).toBe(0);
    });
  });

  // ─── clearSession ──────────────────────────────────────────────

  describe('clearSession', () => {
    it('clears memory store but preserves keychain entries', async () => {
      const memStore = new TestSecretStore();
      const keychainStore = new TestSecretStore();
      const manager = new CredentialManager(
        memStore,
        keychainStore,
        makePromptCallback({ session_key: { value: 'session_value', remembered: false } }),
      );

      // Populate session memory through the manager's resolve pipeline
      await manager.resolveCredential(makeRequest({ key: 'session_key', label: 'Session Key' }));
      // Populate keychain directly (simulating a pre-existing persisted entry)
      await keychainStore.set('persisted_key', 'persisted_value');

      manager.clearSession();

      const memVal = await memStore.get('session_key');
      const keychainVal = await keychainStore.get('persisted_key');

      expect(memVal).toBeNull();
      expect(keychainVal).toBe('persisted_value');
    });

    it('clearSession does not delete keychain entries', async () => {
      const keychainStore = new TestSecretStore();
      const manager = new CredentialManager(
        new TestSecretStore(),
        keychainStore,
        makePromptCallback({ stay_key: { value: 'stay_val', remembered: true } }),
      );

      await manager.resolveCredential(makeRequest({ key: 'stay_key', label: 'Stay' }));

      manager.clearSession();

      const keychainVal = await keychainStore.get('stay_key');
      expect(keychainVal).toBe('stay_val');
    });

    it('after clearSession, resolves from scratch via keychain', async () => {
      const memStore = new TestSecretStore();
      const keychainStore = new TestSecretStore();
      const manager = new CredentialManager(memStore, keychainStore);

      await keychainStore.set('k_key', 'k_value');

      // First resolve: from keychain
      const r1 = await manager.resolveCredential(makeRequest({ key: 'k_key' }));
      expect(r1.status).toBe('found');

      manager.clearSession();

      // After clear: memory gone, must re-fetch from keychain
      const r2 = await manager.resolveCredential(makeRequest({ key: 'k_key' }));
      expect(r2.status).toBe('found');
      expect(r2.entry?.value).toBe('k_value');
    });

    it('clearSession on manager with only memory store works', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(
        memStore,
        undefined,
        makePromptCallback({ clear_test: { value: 'value', remembered: false } }),
      );

      await manager.resolveCredential(makeRequest({ key: 'clear_test', label: 'Clear Test' }));
      manager.clearSession();

      expect(memStore.size).toBe(0);
    });
  });

  // ─── Session-only entries ──────────────────────────────────────

  describe('session-only entries', () => {
    it('marks non-remembered entries as sessionOnly=true', async () => {
      const memStore = new TestSecretStore();
      const manager = new CredentialManager(
        memStore,
        undefined,
        makePromptCallback({ sso_cred: { value: 'sso_value', remembered: false } }),
      );

      const result = await manager.resolveCredential(
        makeRequest({ key: 'sso_cred', label: 'SSO' }),
      );
      expect(result.entry?.sessionOnly).toBe(true);
    });
  });
});
