import { spawn } from 'node:child_process';
import type { SecretStore } from 'itestagent-contracts';

/**
 * KeychainSecretStore — macOS Keychain-backed SecretStore implementation.
 *
 * Stores sensitive credentials (API keys, tokens) in the macOS Keychain
 * via the `/usr/bin/security` command-line tool. The Keychain is the
 * system-level secure credential store on macOS.
 *
 * Service name prefix: `itestagent/` avoids collisions with other apps.
 * Account name: `itestagent` (consistent identifier for all iTestAgent entries).
 *
 * Per US-18.2 AC3: sensitive credentials are never written to JSONC in plaintext.
 * Per R6: sensitive data is stored in Keychain, not on disk in plaintext.
 *
 * Implements {@link SecretStore} from itestagent-contracts.
 *
 * @throws Error if `security` CLI is unavailable (non-macOS) or Keychain access fails.
 */
export class KeychainSecretStore implements SecretStore {
  /** Prefix for all Keychain service names to avoid collision with other applications. */
  static readonly SERVICE_PREFIX = 'itestagent/';

  /** Account name used for all iTestAgent Keychain entries. */
  static readonly ACCOUNT = 'itestagent';

  /** macOS errSecItemNotFound exit code from `security` CLI. */
  private static readonly ERR_ITEM_NOT_FOUND = 44;

  /**
   * Run a `security` CLI command and return stdout as string.
   *
   * @param args - Arguments passed to `/usr/bin/security`
   * @returns stdout trimmed, or null if item was not found (exit code 44)
   * @throws Error for other non-zero exit codes or spawn failures
   */
  private async runSecurity(args: string[]): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/security', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        errChunks.push(chunk);
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(new Error('security CLI not found. KeychainSecretStore requires macOS.'));
        } else {
          reject(new Error(`Failed to spawn security CLI: ${err.message}`));
        }
      });

      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks).toString('utf-8').trim());
        } else if (code === KeychainSecretStore.ERR_ITEM_NOT_FOUND) {
          // Item not found in Keychain — not an error, just absent
          resolve(null);
        } else {
          const stderr = Buffer.concat(errChunks).toString('utf-8').trim();
          reject(new Error(`security CLI exited with code ${code}: ${stderr}`));
        }
      });
    });
  }

  /**
   * Build the service name with the `itestagent/` prefix.
   */
  private serviceName(key: string): string {
    return `${KeychainSecretStore.SERVICE_PREFIX}${key}`;
  }

  /**
   * Retrieve a stored secret by key from the macOS Keychain.
   *
   * @returns The secret value, or null if the key does not exist.
   * @throws Error if Keychain access fails for reasons other than "not found".
   */
  async get(key: string): Promise<string | null> {
    const result = await this.runSecurity([
      'find-generic-password',
      '-s',
      this.serviceName(key),
      '-a',
      KeychainSecretStore.ACCOUNT,
      '-w',
    ]);
    return result; // null if not found, string if found
  }

  /**
   * Store a secret value in the macOS Keychain.
   *
   * The `-U` flag allows updating an existing entry without prompting
   * for the Keychain password (application-specific access is preserved).
   *
   * @throws Error if Keychain write fails.
   */
  async set(key: string, value: string): Promise<void> {
    await this.runSecurity([
      'add-generic-password',
      '-s',
      this.serviceName(key),
      '-a',
      KeychainSecretStore.ACCOUNT,
      '-w',
      value,
      '-U',
    ]);
  }

  /**
   * Delete a stored secret from the macOS Keychain.
   *
   * No-op if the key does not exist (errSecItemNotFound is silently ignored).
   *
   * @throws Error if Keychain access fails for reasons other than "not found".
   */
  async delete(key: string): Promise<void> {
    const result = await this.runSecurity([
      'delete-generic-password',
      '-s',
      this.serviceName(key),
      '-a',
      KeychainSecretStore.ACCOUNT,
    ]);
    // null result from delete means item didn't exist — that's fine
    void result;
  }
}
