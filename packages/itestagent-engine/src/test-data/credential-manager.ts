import type {
  CredentialEntry,
  CredentialManager as CredentialManagerInterface,
  CredentialRequest,
  CredentialResolveResult,
  SecretStore,
} from 'itestagent-contracts';

import type { PermissionEngine } from '../permission-engine.js';

// ─── Types ─────────────────────────────────────────────────

/**
 * Callback signature for user credential prompt.
 * Returns a response indicating whether the user provided or skipped the credential.
 */
export type PromptCallback = (
  request: CredentialRequest,
) => Promise<{ status: 'provided' | 'skipped'; value?: string; remembered?: boolean }>;

// ─── CredentialManager ──────────────────────────────────────

/**
 * CredentialManager — resolve credentials through memory → keychain → prompt pipeline.
 *
 * Implements US-10.2:
 *   - AC1: Real account/OTP/payment/permission/token are prompted in TUI.
 *   - AC2: Default session-only, not persisted to disk.
 *   - AC3: "Remember" → store to Keychain with explicit confirmation.
 *   - AC4: Passwords/tokens never in plaintext config/reports/logs (R6).
 *   - AC5: When required=false and user skips, status='skipped'.
 *
 * Pipeline:
 *   1. Check MemorySecretStore (session memory)
 *   2. Check KeychainSecretStore (persisted)
 *   3. Prompt user via callback (TUI integration)
 *   4. If remembered=true AND PermissionEngine allows, store to KeychainSecretStore
 */
export class CredentialManager implements CredentialManagerInterface {
  private readonly memoryStore: SecretStore;
  private readonly keychainStore: SecretStore | undefined;
  private readonly permissionEngine: PermissionEngine | undefined;
  private readonly promptCallback: PromptCallback | undefined;
  private sessionKeys: Set<string> = new Set();

  /**
   * @param memoryStore Session-scoped in-memory store (required).
   * @param keychainStore Persistent Keychain store (optional, macOS-only).
   * @param promptCallback User prompt callback for TUI integration (optional).
   * @param permissionEngine PermissionEngine for gating Keychain writes (ADR-010 §4).
   */
  constructor(
    memoryStore: SecretStore,
    keychainStore?: SecretStore,
    promptCallback?: PromptCallback,
    permissionEngine?: PermissionEngine,
  ) {
    this.memoryStore = memoryStore;
    this.keychainStore = keychainStore;
    this.permissionEngine = permissionEngine;
    this.promptCallback = promptCallback;
  }

  // ── Resolve single credential ─────────────────────────────

  /**
   * Resolve a single credential through the pipeline.
   *
   * 1. Check MemorySecretStore → return 'found' with entry.
   * 2. Check KeychainSecretStore → return 'found' with entry.
   * 3. Call promptCallback → return 'prompted' with entry.
   * 4. No callback → return 'not_found'.
   * 5. User skips → return 'skipped'.
   */
  async resolveCredential(request: CredentialRequest): Promise<CredentialResolveResult> {
    const { key, label, kind } = request;

    // Step 1: Check session memory
    const memValue = await this.memoryStore.get(key);
    if (memValue !== null) {
      return {
        status: 'found',
        entry: this.makeEntry(key, memValue, kind, label, true),
      };
    }

    // Step 2: Check Keychain
    if (this.keychainStore) {
      const keychainValue = await this.keychainStore.get(key);
      if (keychainValue !== null) {
        // Load into session memory for fast subsequent lookups
        await this.memoryStore.set(key, keychainValue);
        this.trackSessionKey(key);
        return {
          status: 'found',
          entry: this.makeEntry(key, keychainValue, kind, label, false),
        };
      }
    }

    // Step 3: Prompt user
    if (this.promptCallback) {
      const response = await this.promptCallback(request);

      if (response.status === 'skipped') {
        return {
          status: 'skipped',
          reason: `User skipped credential "${label}"`,
        };
      }

      if (response.value === undefined || response.value === null) {
        return {
          status: 'not_found',
          reason: `Credential callback returned "provided" but no value for "${key}"`,
        };
      }

      const value = response.value;
      const remembered = response.remembered ?? false;

      // Step 3a: Store to session memory
      await this.memoryStore.set(key, value);
      this.trackSessionKey(key);

      // Step 3b: Store to Keychain if remembered AND permission allows (R7/ADR-010)
      if (remembered && this.keychainStore) {
        if (this.permissionEngine) {
          const gate = this.permissionEngine.check('credential_store', key);
          if (gate === 'allow') {
            await this.keychainStore.set(key, value);
          }
        } else {
          await this.keychainStore.set(key, value);
        }
      }

      return {
        status: 'prompted',
        entry: this.makeEntry(key, value, kind, label, !remembered),
      };
    }

    // Step 4: No credential found anywhere
    return {
      status: 'not_found',
      reason: `No stored credential for "${key}" and no prompt callback available`,
    };
  }

  // ── Resolve multiple credentials (batch) ──────────────────

  /**
   * Resolve multiple credentials in batch.
   * Returns a Map of key → result for each requested credential.
   */
  async resolveCredentials(
    requests: CredentialRequest[],
  ): Promise<Map<string, CredentialResolveResult>> {
    const results = new Map<string, CredentialResolveResult>();

    for (const req of requests) {
      const result = await this.resolveCredential(req);
      results.set(req.key, result);
    }

    return results;
  }

  // ── Session lifecycle ─────────────────────────────────────

  /**
   * Clear all session-only credentials from memory.
   *
   * Only clears entries that were stored through this CredentialManager
   * (tracked session keys). Persisted Keychain entries are NOT affected.
   */
  async clearSession(): Promise<void> {
    const deletions: Promise<void>[] = [];
    for (const key of this.sessionKeys) {
      deletions.push(this.memoryStore.delete(key));
    }
    await Promise.all(deletions);
    this.sessionKeys.clear();
  }

  // ── Internal helpers ──────────────────────────────────────

  /**
   * Track a session key for clearSession support.
   */
  private trackSessionKey(key: string): void {
    this.sessionKeys.add(key);
  }

  /**
   * Build a CredentialEntry with proper metadata.
   * @param sessionOnly Whether this entry lives only in session memory.
   */
  private makeEntry(
    key: string,
    value: string,
    kind: CredentialRequest['kind'],
    label: string,
    sessionOnly: boolean,
  ): CredentialEntry {
    return {
      key,
      value,
      kind,
      storedAt: new Date().toISOString(),
      sessionOnly,
      label,
    };
  }
}
