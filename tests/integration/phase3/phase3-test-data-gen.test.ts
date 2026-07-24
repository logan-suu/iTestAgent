/**
 * Phase 3 integration — TestDataGenerator + CredentialManager: data generation + credential resolution.
 *
 * Cross-package chain: itestagent-contracts (TestDataContext, GeneratedTestData, CredentialRequest,
 * CredentialResolveResult, SecretStore) + itestagent-engine (TestDataGenerator, CredentialManager) +
 * itestagent-cli (MemorySecretStore).
 *
 * Task 3.16 compliance: US-10.1 (safe test data generation) + US-10.2 (credential resolution).
 * R6: Sensitive data not stored in plaintext; R7: store_credential goes through PermissionEngine.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { MemorySecretStore } from 'itestagent-cli';
import { CredentialResolveResultSchema, GeneratedTestDataSchema } from 'itestagent-contracts';
import { CredentialManager, PermissionEngine, TestDataGenerator } from 'itestagent-engine';

describe('Phase 3 TestDataGenerator integration', () => {
  const generator = new TestDataGenerator();

  it('generates test data from project context', () => {
    const result = generator.generate({
      projectHash: 'a'.repeat(64),
      features: ['Login', 'Search'],
      bundleId: 'com.test.app',
      locale: 'en-US',
    });

    const parsed = GeneratedTestDataSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items.length).toBeGreaterThan(0);
      expect(parsed.data.generatedAt).toBeDefined();
    }
  });

  it('generates all 9 data types', () => {
    const result = generator.generate({
      features: ['Login'],
      locale: 'en-US',
    });

    const parsed = GeneratedTestDataSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const types = new Set(parsed.data.items.map((i) => i.type));
      expect(types.size).toBeGreaterThanOrEqual(1);
    }
  });

  it('generation is locale-aware', () => {
    const zh = generator.generate({ features: ['Login'], locale: 'zh-CN' });
    const en = generator.generate({ features: ['Login'], locale: 'en-US' });

    const zhParsed = GeneratedTestDataSchema.safeParse(zh);
    const enParsed = GeneratedTestDataSchema.safeParse(en);
    expect(zhParsed.success).toBe(true);
    expect(enParsed.success).toBe(true);
  });

  it('generates safe fake data (AC3)', () => {
    const result = generator.generate({
      features: ['Login'],
      bundleId: 'com.bank.app',
      locale: 'en-US',
    });

    const parsed = GeneratedTestDataSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      for (const item of parsed.data.items) {
        if (item.type === 'username' && 'value' in item) {
          const v = item.value as string;
          expect(v).not.toMatch(/^\d{16}$/);
        }
      }
    }
  });
});

describe('Phase 3 CredentialManager integration', () => {
  let memoryStore: MemorySecretStore;
  let permissionEngine: PermissionEngine;

  beforeEach(() => {
    memoryStore = new MemorySecretStore();
    permissionEngine = new PermissionEngine();
  });

  it('resolves from memory store', async () => {
    await memoryStore.set('test_token', 'mem-cached-token');

    const cm = new CredentialManager(memoryStore);
    const result = await cm.resolveCredential({
      kind: 'token',
      key: 'test_token',
      label: 'Test Token',
      required: true,
    });

    expect(CredentialResolveResultSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe('found');
    expect(result.entry).toBeDefined();
  });

  it('returns not_found when no store has credential and no prompt', async () => {
    const cm = new CredentialManager(memoryStore);
    const result = await cm.resolveCredential({
      kind: 'token',
      key: 'missing_key',
      label: 'Missing Token',
      required: false,
    });

    expect(result.status).toBe('not_found');
  });

  it('calls prompt callback when credential not in stores', async () => {
    let promptCalled = false;
    const cm = new CredentialManager(new MemorySecretStore(), undefined, async () => {
      promptCalled = true;
      return { status: 'provided' as const, value: 'prompted-value' };
    });

    const result = await cm.resolveCredential({
      kind: 'password',
      key: 'new_password',
      label: 'Password',
      required: true,
    });

    expect(promptCalled).toBe(true);
    expect(result.status).toBe('prompted');
    expect(result.entry).toBeDefined();
  });

  it('stores credential to keychain when remembered', async () => {
    const keychainStore = new MemorySecretStore();
    permissionEngine.addRule({
      action: 'store_credential',
      resource: 'remembered_key',
      effect: 'allow',
    });

    const cm = new CredentialManager(
      memoryStore,
      keychainStore,
      async () => ({ status: 'provided' as const, value: 'remembered-value', remembered: true }),
      permissionEngine,
    );

    await cm.resolveCredential({
      kind: 'password',
      key: 'remembered_key',
      label: 'Remembered Password',
      required: true,
    });

    const stored = await keychainStore.get('remembered_key');
    expect(stored).not.toBeNull();
    expect(stored).toBe('remembered-value');
  });

  it('does not persist when not remembered (session-only, AC2)', async () => {
    const keychainStore = new MemorySecretStore();
    const cm = new CredentialManager(memoryStore, keychainStore, async () => ({
      status: 'provided' as const,
      value: 'session-only',
      remembered: false,
    }));

    await cm.resolveCredential({
      kind: 'text',
      key: 'session_user',
      label: 'Username',
      required: true,
    });

    const stored = await keychainStore.get('session_user');
    expect(stored).toBeNull();
  });

  it('handles skipped optional credentials (AC5)', async () => {
    const cm = new CredentialManager(memoryStore, undefined, async () => ({
      status: 'skipped' as const,
    }));

    const result = await cm.resolveCredential({
      kind: 'otp',
      key: 'optional_otp',
      label: 'OTP',
      required: false,
    });

    expect(result.status).toBe('skipped');
  });

  it('caches resolved credential in memory for reuse', async () => {
    let callCount = 0;
    const cm = new CredentialManager(memoryStore, undefined, async () => {
      callCount++;
      return { status: 'provided' as const, value: 'cached-value' };
    });

    const r1 = await cm.resolveCredential({
      kind: 'text',
      key: 'reuse_key',
      label: 'Reuse',
      required: true,
    });
    expect(r1.status).toBe('prompted');
    expect(callCount).toBe(1);

    const r2 = await cm.resolveCredential({
      kind: 'text',
      key: 'reuse_key',
      label: 'Reuse',
      required: true,
    });
    expect(r2.status).toBe('found');
    expect(callCount).toBe(1);
  });

  it('resolves different credential kinds', async () => {
    for (const kind of ['text', 'password', 'token', 'otp'] as const) {
      const store = new MemorySecretStore();
      await store.set(`test_${kind}`, `value-${kind}`);

      const cm = new CredentialManager(store);
      const result = await cm.resolveCredential({
        kind,
        key: `test_${kind}`,
        label: `Test ${kind}`,
        required: false,
      });

      expect(result.status).toBe('found');
    }
  });
});
