/**
 * API key loader — Keychain-first with fail-closed plaintext rejection.
 *
 * Guide §6.4 credential persistence contract:
 *   - The API key lives in the macOS Keychain (default target mirrors the
 *     established `itestagent/openai_api_key` / `itestagent` convention).
 *   - A config file may carry a Keychain POINTER (service/account), never
 *     the secret itself. Inline plaintext keys (`apiKey`, `api_key`, …)
 *     are rejected fail-closed: they are never used and never returned.
 *   - Reading failure must NOT fall back to a plaintext file. When the
 *     Keychain read fails, the loader returns a typed error — full stop.
 *
 * Every outcome is a Result: the loader never throws.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import {
  type KeychainError,
  type KeychainTarget,
  type Result,
  createSecurityRunner,
  loadCredential,
} from './keychain-persistence.js';

// ─── Public API ─────────────────────────────────────────────

/** Default Keychain target (matches the existing agent-session convention). */
export const DEFAULT_API_KEY_TARGET: KeychainTarget = Object.freeze({
  service: 'itestagent/openai_api_key',
  account: 'itestagent',
});

/** Default config location (~/.itestagent/config/itestagent.jsonc). */
export function defaultConfigPath(): string {
  return resolve(homedir(), '.itestagent', 'config', 'itestagent.jsonc');
}

export type ApiKeyLoaderErrorCode =
  | 'plaintext_config_rejected'
  | 'keychain_read_failed'
  | 'empty_value';

export interface ApiKeyLoaderError {
  readonly code: ApiKeyLoaderErrorCode;
  /** Human-readable message. Must never contain secret material. */
  readonly message: string;
  readonly detail?: KeychainError;
}

export interface LoadedApiKey {
  readonly value: string;
  readonly source: 'keychain';
  readonly target: KeychainTarget;
}

export interface ApiKeyLoaderDeps {
  /**
   * Reads the config file; null/throwing means "absent or unreadable"
   * (defaults apply). Injected for tests.
   */
  readonly configReader?: (path: string) => string | null;
  /** Keychain reader. Injected for tests; defaults to the security CLI. */
  readonly keychainLoader?: (target: KeychainTarget) => Promise<Result<string, KeychainError>>;
  readonly configPath?: string;
}

// ─── Config scanning ────────────────────────────────────────

/** Config keys that indicate an inline plaintext secret (forbidden). */
const FORBIDDEN_SECRET_KEYS = new Set(['apikey', 'api_key', 'secretkey', 'secret_key']);

interface ConfigScan {
  readonly pointer: Partial<KeychainTarget> | null;
  readonly plaintextKeyPaths: readonly string[];
}

/**
 * Walks the parsed config and reports:
 *   - any inline plaintext secret keys (contract violation), and
 *   - an optional model.apiKeySource Keychain pointer.
 */
function scanConfig(raw: string): ConfigScan {
  const parsed = parseJsonc(raw) as Record<string, unknown> | undefined;
  const plaintextKeyPaths: string[] = [];

  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const normalized = key.toLowerCase();
      const childPath = path.length > 0 ? `${path}.${key}` : key;
      if (FORBIDDEN_SECRET_KEYS.has(normalized) && typeof value === 'string') {
        plaintextKeyPaths.push(childPath);
        continue;
      }
      if (key === 'apiKeySource') continue; // pointer container, inspected below
      visit(value, childPath);
    }
  };
  visit(parsed, '');

  let pointer: Partial<KeychainTarget> | null = null;
  const model = parsed?.model as Record<string, unknown> | undefined;
  const source = model?.apiKeySource as Record<string, unknown> | undefined;
  if (source && source.type === 'keychain') {
    pointer = {
      service: typeof source.service === 'string' ? source.service : undefined,
      account: typeof source.account === 'string' ? source.account : undefined,
    };
  }

  return { pointer, plaintextKeyPaths };
}

// ─── Loader ─────────────────────────────────────────────────

export async function loadApiKey(
  deps: ApiKeyLoaderDeps = {},
): Promise<Result<LoadedApiKey, ApiKeyLoaderError>> {
  const configPath = deps.configPath ?? defaultConfigPath();
  const readConfig = deps.configReader ?? ((path: string) => readConfigFile(path));
  const keychainLoader =
    deps.keychainLoader ??
    ((target: KeychainTarget) => loadCredential(createSecurityRunner(), target));

  // Step 1: scan the config (if any) for contract violations and pointers.
  let rawConfig: string | null = null;
  try {
    rawConfig = readConfig(configPath);
  } catch {
    rawConfig = null;
  }

  let pointer: Partial<KeychainTarget> | null = null;
  if (rawConfig !== null && rawConfig !== undefined) {
    const scan = scanConfig(rawConfig);
    if (scan.plaintextKeyPaths.length > 0) {
      // Fail-closed: report the violation WITHOUT echoing any secret bytes.
      return {
        ok: false,
        error: {
          code: 'plaintext_config_rejected',
          message: `Config contains an inline plaintext API key at '${scan.plaintextKeyPaths[0] ?? '<unknown>'}'. Store it in the Keychain instead.`,
        },
      };
    }
    pointer = scan.pointer;
  }

  // Step 2: resolve the Keychain target (pointer overrides defaults).
  const target: KeychainTarget = {
    service: pointer?.service ?? DEFAULT_API_KEY_TARGET.service,
    account: pointer?.account ?? DEFAULT_API_KEY_TARGET.account,
  };

  // Step 3: read from the Keychain. On failure: typed error, NO fallback.
  const loaded = await keychainLoader(target);
  if (!loaded.ok) {
    return {
      ok: false,
      error: {
        code: 'keychain_read_failed',
        message: `Keychain read failed for service '${target.service}'`,
        detail: loaded.error,
      },
    };
  }

  const value = loaded.value.trim();
  if (value.length === 0) {
    return {
      ok: false,
      error: { code: 'empty_value', message: 'Keychain returned an empty API key' },
    };
  }

  return { ok: true, value: { value, source: 'keychain', target } };
}

function readConfigFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}
