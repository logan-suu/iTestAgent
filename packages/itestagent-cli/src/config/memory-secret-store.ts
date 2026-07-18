import type { SecretStore } from 'itestagent-contracts';

/**
 * MemorySecretStore — in-memory Map-based SecretStore implementation.
 *
 * Sensitive credentials (API keys, tokens) stored only in process memory,
 * never persisted to disk. Primary uses:
 *   1. Unit tests (no real Keychain dependency needed)
 *   2. Graceful fallback when macOS Keychain is unavailable
 *   3. Non-macOS environments (dev/testing on Linux)
 *
 * Per R6: sensitive data must not be written to disk in plaintext.
 * This store is ephemeral — data is lost on process exit.
 *
 * Implements {@link SecretStore} from itestagent-contracts.
 */
export class MemorySecretStore implements SecretStore {
  #store = new Map<string, string>();

  /**
   * Retrieve a stored secret by key.
   * @returns The secret value, or null if the key does not exist.
   */
  async get(key: string): Promise<string | null> {
    return this.#store.get(key) ?? null;
  }

  /**
   * Store a secret value under the given key.
   * Overwrites any existing value for the same key.
   */
  async set(key: string, value: string): Promise<void> {
    this.#store.set(key, value);
  }

  /**
   * Delete a stored secret by key.
   * No-op if the key does not exist.
   */
  async delete(key: string): Promise<void> {
    this.#store.delete(key);
  }

  /**
   * Get the number of stored entries (useful for test assertions).
   */
  get size(): number {
    return this.#store.size;
  }
}
