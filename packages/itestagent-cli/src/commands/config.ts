/**
 * Config command handlers — B17 module split (promotion guide §11.3 "CLI
 * safety/config"). Extracted verbatim from the former inline implementations
 * in cli.ts and made dependency-injectable so tests can drive every flow
 * without a TTY or real Keychain.
 *
 * Safety contract (R6/R7):
 *   - set-secret requires a Keychain-backed store, explicit confirmation,
 *     and reads the value through the hidden-input reader — plaintext never
 *     reaches stdout/stderr;
 *   - get-secret displays a stored credential only after explicit
 *     confirmation (caller owns pipe security);
 *   - delete-secret confirms before removal;
 *   - every abort surfaces as a typed {@link PublicCliError} ('Aborted.')
 *     instead of calling process.exit inline.
 */
import { confirmAction } from '../config/confirm.js';
import { readHiddenSecret } from '../config/hidden-secret-input.js';
import { KeychainSecretStore } from '../config/keychain-secret-store.js';
import {
  type LoadConfigResult,
  createSecretStore,
  loadConfig,
  resolveCredentials,
} from '../config/loader.js';
import { PublicCliError } from '../public-error.js';

type SecretStoreInstance = ReturnType<typeof createSecretStore>;

export interface ConfigCommandContext {
  /** Writable stream for normal output (defaults to process.stdout). */
  stdout?: NodeJS.WritableStream;
  /** Writable stream for diagnostics (defaults to process.stderr). */
  stderr?: NodeJS.WritableStream;
  /** Injectable config loader (defaults to loadConfig). */
  loadConfigFn?: () => Promise<LoadConfigResult>;
  /** Injectable secret-store factory (defaults to createSecretStore). */
  createSecretStoreFn?: () => SecretStoreInstance;
  /** Injectable confirmation prompt (defaults to confirmAction). */
  confirmFn?: (input: { action: string; details: string }) => Promise<string>;
  /** Injectable hidden-input reader (defaults to readHiddenSecret). */
  readHiddenFn?: typeof readHiddenSecret;
}

/** Shows the effective merged config, its source files, and credentials status. */
export async function runConfigShow(ctx: ConfigCommandContext = {}): Promise<void> {
  const stdout = ctx.stdout ?? process.stdout;
  const stderr = ctx.stderr ?? process.stderr;
  const { config, sources } = await (ctx.loadConfigFn ?? loadConfig)();

  stdout.write(`${JSON.stringify(config, null, 2)}\n`);

  stderr.write('\nConfig sources:\n');
  for (const source of sources) {
    const mark = source.exists ? '\u2713' : '\u2717';
    stderr.write(`  ${mark} ${source.path}\n`);
  }

  // Show credential status
  if (config.model.apiKeyRef) {
    const secretStore = ctx.createSecretStoreFn?.() ?? createSecretStore();
    const { resolvedApiKey } = await resolveCredentials(config, secretStore);
    stderr.write(
      `\nCredentials: apiKeyRef="${config.model.apiKeyRef}" → ${resolvedApiKey ? 'resolved (Keychain)' : 'NOT FOUND in Keychain'}\n`,
    );
  }
}

/** Default config action (no subcommand) — same output as `config show`. */
export async function runConfigDefault(ctx: ConfigCommandContext = {}): Promise<void> {
  const stdout = ctx.stdout ?? process.stdout;
  const stderr = ctx.stderr ?? process.stderr;
  const { config, sources } = await (ctx.loadConfigFn ?? loadConfig)();

  stdout.write(`${JSON.stringify(config, null, 2)}\n`);

  stderr.write('\nConfig sources:\n');
  for (const source of sources) {
    const mark = source.exists ? '\u2713' : '\u2717';
    stderr.write(`  ${mark} ${source.path}\n`);
  }
}

/**
 * Stores a credential in the macOS Keychain after explicit confirmation,
 * reading the value through the hidden-input reader.
 */
export async function runConfigSetSecret(
  key: string,
  ctx: ConfigCommandContext = {},
): Promise<void> {
  const stdout = ctx.stdout ?? process.stdout;
  const store = ctx.createSecretStoreFn?.() ?? createSecretStore();

  if (!(store instanceof KeychainSecretStore)) {
    throw new PublicCliError('KeychainSecretStore is only available on macOS.');
  }

  // Confirm high-risk operation before storing (R7).
  const confirmed = await (ctx.confirmFn ?? confirmAction)({
    action: 'Store credential',
    details: `Store a credential for "${key}" in macOS Keychain`,
  });
  if (confirmed !== 'yes') {
    throw new PublicCliError('Aborted.');
  }

  // Read secret with echo suppressed (R6).
  const value = await (ctx.readHiddenFn ?? readHiddenSecret)({
    prompt: `Enter value for "${key}" (input hidden): `,
  });

  if (!value) {
    throw new PublicCliError('Error: empty value is not allowed.');
  }

  await store.set(key, value);
  stdout.write(`Credential "${key}" stored in Keychain.\n`);
}

/**
 * Retrieves a stored credential — displayed only after explicit
 * confirmation (R6 + R7).
 */
export async function runConfigGetSecret(
  key: string,
  ctx: ConfigCommandContext = {},
): Promise<void> {
  const stdout = ctx.stdout ?? process.stdout;
  const store = ctx.createSecretStoreFn?.() ?? createSecretStore();

  const confirmed = await (ctx.confirmFn ?? confirmAction)({
    action: 'Read credential',
    details: `Display the credential for "${key}" in terminal output (visible on screen and in shell history).`,
  });
  if (confirmed !== 'yes') {
    throw new PublicCliError('Aborted.');
  }

  const value = await store.get(key);
  if (value === null) {
    throw new PublicCliError(`Credential "${key}" not found.`);
  }
  // R6: credential is output after explicit confirmation only.
  // The caller is responsible for pipe security — prefer TUI for sensitive display.
  stdout.write(`${value}\n`);
}

/** Removes a stored credential after explicit confirmation. */
export async function runConfigDeleteSecret(
  key: string,
  ctx: ConfigCommandContext = {},
): Promise<void> {
  const stdout = ctx.stdout ?? process.stdout;
  const store = ctx.createSecretStoreFn?.() ?? createSecretStore();

  const confirmed = await (ctx.confirmFn ?? confirmAction)({
    action: 'Delete credential',
    details: `Remove the credential for "${key}" from macOS Keychain`,
  });
  if (confirmed !== 'yes') {
    throw new PublicCliError('Aborted.');
  }

  await store.delete(key);
  stdout.write(`Credential "${key}" removed from Keychain.\n`);
}
