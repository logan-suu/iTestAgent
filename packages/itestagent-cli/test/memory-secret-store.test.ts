import { expect, test } from 'bun:test';
import { MemorySecretStore } from '../src/config/memory-secret-store.js';

test('set + get returns stored value', async () => {
  const store = new MemorySecretStore();
  await store.set('api-key', 'sk-test-123');
  const value = await store.get('api-key');
  expect(value).toBe('sk-test-123');
});

test('get returns null for unknown key', async () => {
  const store = new MemorySecretStore();
  const value = await store.get('nonexistent');
  expect(value).toBeNull();
});

test('set overwrites existing key', async () => {
  const store = new MemorySecretStore();
  await store.set('token', 'old-token');
  await store.set('token', 'new-token');
  const value = await store.get('token');
  expect(value).toBe('new-token');
});

test('delete removes key', async () => {
  const store = new MemorySecretStore();
  await store.set('secret', 'value');
  await store.delete('secret');
  const value = await store.get('secret');
  expect(value).toBeNull();
});

test('delete is no-op for unknown key', async () => {
  const store = new MemorySecretStore();
  // Should not throw
  await store.delete('does-not-exist');
  expect(store.size).toBe(0);
});
