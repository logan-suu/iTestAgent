import { afterAll, beforeAll, expect, test } from 'bun:test';
import { platform } from 'node:os';
import { KeychainSecretStore } from '../src/config/keychain-secret-store.js';

const isMacOS = platform() === 'darwin';

// Test keys use a unique suffix to avoid collision with real credentials
const TEST_PREFIX = `itestagent-test-${Date.now()}-`;
let keyIndex = 0;
function testKey(): string {
  return `${TEST_PREFIX}${keyIndex++}`;
}

let store: KeychainSecretStore;

beforeAll(() => {
  store = new KeychainSecretStore();
});

afterAll(async () => {
  // Clean up all test entries from Keychain (best-effort)
  for (let i = 0; i < keyIndex; i++) {
    try {
      await store.delete(`${TEST_PREFIX}${i}`);
    } catch {
      // Ignore cleanup errors
    }
  }
});

// --- macOS-only integration tests ---

test.skipIf(!isMacOS)('set + get returns stored value (macOS Keychain)', async () => {
  const key = testKey();
  const secret = 'test-secret-value-123';
  await store.set(key, secret);
  const result = await store.get(key);
  expect(result).toBe(secret);
});

test.skipIf(!isMacOS)('get returns null for nonexistent key (macOS Keychain)', async () => {
  const key = testKey();
  const result = await store.get(key);
  expect(result).toBeNull();
});

test.skipIf(!isMacOS)('delete removes key from Keychain', async () => {
  const key = testKey();
  await store.set(key, 'delete-me');
  await store.delete(key);
  const result = await store.get(key);
  expect(result).toBeNull();
});

test.skipIf(!isMacOS)('set overwrites existing Keychain entry', async () => {
  const key = testKey();
  await store.set(key, 'old-value');
  await store.set(key, 'new-value');
  const result = await store.get(key);
  expect(result).toBe('new-value');
});

// --- Unit tests (runs on all platforms with MemorySecretStore as fallback) ---

test('KeychainSecretStore.SERVICE_PREFIX is itestagent/', () => {
  expect(KeychainSecretStore.SERVICE_PREFIX).toBe('itestagent/');
});

test('KeychainSecretStore.ACCOUNT is itestagent', () => {
  expect(KeychainSecretStore.ACCOUNT).toBe('itestagent');
});
