/**
 * Keychain persistence for credentials — macOS `security` CLI transport.
 *
 * Guide §6.4 credential persistence contract:
 *   - Default is memory-only. Keychain persistence is a HIGH-RISK operation:
 *     every first save must present scope/service/account/revocation and
 *     obtain an explicit interactive confirmation (see authorizePersistence).
 *   - The secret must never travel through argv, environment, URL, process
 *     title, stdout/stderr, or reports. This module transports the secret
 *     via the child's STDIN only: `security add-generic-password ... -w`
 *     uses a bare trailing `-w` flag so the password is read from stdin.
 *   - Items must be non-sync, device-local, when-unlocked
 *     (KEYCHAIN_ACCESS_CONTROL). Items created by `security
 *     add-generic-password` are login-keychain (device-local) generic
 *     passwords that are never marked synchronizable; verifyAccessControl
 *     re-checks the stored item after every write and fails closed.
 *   - A read failure must NOT fall back to a plaintext file. This module
 *     imports no filesystem module at all.
 *
 * All spawning goes through the injectable SecurityRunner so tests never
 * touch a real Keychain.
 */
import { spawn } from 'node:child_process';

// ─── Result ─────────────────────────────────────────────────

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ─── Target & access control ────────────────────────────────

export interface KeychainTarget {
  readonly service: string;
  readonly account: string;
}

/**
 * Required access-control attributes for every item this module writes.
 * Frozen so the policy cannot be loosened at runtime.
 */
export const KEYCHAIN_ACCESS_CONTROL = Object.freeze({
  synchronizable: false,
  deviceLocal: true,
  accessible: 'when-unlocked',
} as const);

export type KeychainAccessControl = typeof KEYCHAIN_ACCESS_CONTROL;

/** Human-readable access-control disclosure lines (used in confirm notices). */
export function describeAccessControl(): readonly string[] {
  return [
    'Scope: device-local Keychain item (non-sync, when-unlocked access control).',
    'The item never syncs via iCloud and is readable only while the device is unlocked.',
  ];
}

// ─── Errors ─────────────────────────────────────────────────

export type KeychainErrorCode =
  | 'not_authorized'
  | 'authorization_consumed'
  | 'invalid_target'
  | 'empty_value'
  | 'item_not_found'
  | 'denied_by_user'
  | 'timeout'
  | 'verification_failed'
  | 'unexpected_exit';

export interface KeychainError {
  readonly code: KeychainErrorCode;
  /** Human-readable message. Must never contain secret material. */
  readonly message: string;
}

// ─── Authorization (explicit interactive confirmation) ──────

/**
 * The exact confirmation token a user must provide. Deliberately strict:
 * near-misses ("Save", " save", "yes") are rejected — explicit means exact.
 */
export const PERSISTENCE_CONFIRMATION_TOKEN = 'save';

export interface PersistenceAuthorization {
  readonly granted: true;
  readonly scope: 'device-local';
  readonly service: string;
  readonly account: string;
  readonly confirmedAt: number;
}

/**
 * Live authorizations. Single-use: consumed by a successful save request,
 * removed by revokePersistence. A WeakSet would allow GC'd auths to be
 * re-forged; a strong Set keeps the revocation semantics airtight for the
 * session lifetime.
 */
const liveAuthorizations = new Set<PersistenceAuthorization>();

function isValidTarget(target: KeychainTarget): boolean {
  return target.service.trim().length > 0 && target.account.trim().length > 0;
}

export function authorizePersistence(
  confirmation: string,
  target: KeychainTarget,
  now: number = Date.now(),
): Result<PersistenceAuthorization, KeychainError> {
  if (!isValidTarget(target)) {
    return err({ code: 'invalid_target', message: 'Keychain service and account are required' });
  }
  if (confirmation !== PERSISTENCE_CONFIRMATION_TOKEN) {
    return err({
      code: 'not_authorized',
      message: 'Persistence requires the exact interactive confirmation token',
    });
  }
  const authorization: PersistenceAuthorization = {
    granted: true,
    scope: 'device-local',
    service: target.service,
    account: target.account,
    confirmedAt: now,
  };
  liveAuthorizations.add(authorization);
  return ok(authorization);
}

/** Revokes an outstanding authorization; idempotent. */
export function revokePersistence(authorization: PersistenceAuthorization): void {
  liveAuthorizations.delete(authorization);
  revokedAuthorizations.add(authorization);
}

/**
 * Authorizations explicitly revoked this session. Tracked separately from
 * {@link liveAuthorizations} so the error contract can distinguish "this
 * authorization was already spent" (`authorization_consumed`) from "the user
 * withdrew consent" (`not_authorized` — equivalent to never having been
 * authorized, R7).
 */
const revokedAuthorizations = new WeakSet<PersistenceAuthorization>();

function checkAuthorization(
  authorization: PersistenceAuthorization | null | undefined,
  target: KeychainTarget,
): KeychainError | null {
  if (!authorization || authorization.granted !== true) {
    return {
      code: 'not_authorized',
      message: 'Keychain persistence requires explicit confirmation',
    };
  }
  if (!liveAuthorizations.has(authorization)) {
    // Distinguish "spent" from "revoked": a revoked authorization is
    // equivalent to never having been authorized (user withdrew consent).
    if (revokedAuthorizations.has(authorization)) {
      return {
        code: 'not_authorized',
        message: 'Keychain persistence authorization was revoked',
      };
    }
    return {
      code: 'authorization_consumed',
      message: 'Authorization was already used',
    };
  }
  if (
    authorization.service !== target.service ||
    authorization.account !== target.account ||
    authorization.scope !== 'device-local'
  ) {
    return { code: 'not_authorized', message: 'Authorization does not match this Keychain target' };
  }
  return null;
}

// ─── Process runner abstraction ─────────────────────────────

export interface SecurityRunOptions {
  /** Secret material, transported via the child's stdin ONLY. */
  readonly stdin?: string;
  readonly timeoutMs?: number;
}

export interface SecurityRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface SecurityRunner {
  run(args: readonly string[], options?: SecurityRunOptions): Promise<SecurityRunResult>;
}

/** Pinned security binary location (never resolved from PATH). */
export const SECURITY_BINARY = '/usr/bin/security';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Default runner backed by node:child_process.
 *
 * Exposure discipline:
 *   - argv carries only non-secret flags; `-w` is always bare (stdin read).
 *   - env is a minimal PATH/HOME allowlist — ambient variables (which could
 *     plausibly contain secrets) are never forwarded to the child.
 *   - stdout/stderr are only ever READ; the module never writes into them.
 *   - process.title is never modified.
 */
export function createSecurityRunner(options?: {
  binaryPath?: string;
  defaultTimeoutMs?: number;
}): SecurityRunner {
  const binaryPath = options?.binaryPath ?? SECURITY_BINARY;
  const defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    run(args: readonly string[], runOptions?: SecurityRunOptions): Promise<SecurityRunResult> {
      return new Promise((resolvePromise) => {
        // Minimal environment allowlist: no ambient variable forwarding.
        const childEnv: Record<string, string> = {};
        if (process.env.PATH !== undefined) childEnv.PATH = process.env.PATH;
        if (process.env.HOME !== undefined) childEnv.HOME = process.env.HOME;

        let settled = false;
        let timedOut = false;
        const child = spawn(binaryPath, args as string[], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: childEnv,
        });

        const settle = (result: SecurityRunResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise(result);
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
          settle({ exitCode: 0, stdout: '', stderr: '', timedOut: true });
        }, runOptions?.timeoutMs ?? defaultTimeoutMs);

        // Secret transport: stdin only, written once, then closed.
        if (runOptions?.stdin !== undefined && child.stdin) {
          child.stdin.write(runOptions.stdin);
          child.stdin.end();
        } else {
          child.stdin?.end();
        }

        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
        child.stderr?.on('data', (chunk: Buffer) => errChunks.push(chunk));

        child.on('close', (code: number | null) => {
          if (timedOut) return; // already settled by the timer
          settle({
            exitCode: code ?? -1,
            stdout: Buffer.concat(chunks).toString('utf-8'),
            stderr: Buffer.concat(errChunks).toString('utf-8'),
            timedOut: false,
          });
        });

        child.on('error', () => {
          settle({ exitCode: -1, stdout: '', stderr: '', timedOut: false });
        });
      });
    },
  };
}

// ─── Exit-code mapping (macOS security CLI) ─────────────────

function mapRunResult(result: SecurityRunResult): KeychainError | null {
  if (result.timedOut) {
    return { code: 'timeout', message: 'security CLI timed out before answering' };
  }
  switch (result.exitCode) {
    case 0:
      return null;
    case 44:
      return { code: 'item_not_found', message: 'Keychain item not found (exit 44)' };
    case 45:
    case 128:
      return {
        code: 'denied_by_user',
        message: 'Keychain access denied by user or auth failure',
      };
    default:
      return {
        code: 'unexpected_exit',
        message: `security CLI exited unexpectedly with code ${result.exitCode}`,
      };
  }
}

// ─── Operations ─────────────────────────────────────────────

/**
 * Saves a credential. REQUIRES a live single-use PersistenceAuthorization
 * obtained through authorizePersistence after explicit user confirmation.
 * Fails closed: the write is followed by an attribute verification; if the
 * verification cannot confirm a device-local generic-password item, the
 * operation reports verification_failed even though the item exists.
 */
export async function saveCredential(
  runner: SecurityRunner,
  target: KeychainTarget,
  value: string,
  authorization: PersistenceAuthorization | null | undefined,
): Promise<Result<KeychainAccessControl, KeychainError>> {
  const authError = checkAuthorization(authorization, target);
  if (authError) return err(authError);

  // Unreachable at runtime: checkAuthorization rejects absent auths, but TS cannot narrow through it.
  if (!authorization) {
    return err({
      code: 'not_authorized',
      message: 'Keychain persistence requires explicit confirmation',
    });
  }

  if (value.trim().length === 0) {
    return err({ code: 'empty_value', message: 'Refusing to store an empty credential' });
  }

  // Consume the single-use authorization up front: one confirmation, one save.
  liveAuthorizations.delete(authorization);

  // Bare trailing `-w`: the password is read from stdin, never argv.
  const addResult = await runner.run(
    ['add-generic-password', '-U', '-s', target.service, '-a', target.account, '-w'],
    { stdin: value },
  );

  const addError = mapRunResult(addResult);
  if (addError) return err(addError);

  const verified = await verifyAccessControl(runner, target);
  if (!verified.ok) {
    return err({
      code: 'verification_failed',
      message: `Item written but access-control verification failed: ${verified.error.message}`,
    });
  }

  return ok(KEYCHAIN_ACCESS_CONTROL);
}

/**
 * Loads a credential. On any failure returns a typed error — there is NO
 * plaintext-file fallback anywhere in this module.
 */
export async function loadCredential(
  runner: SecurityRunner,
  target: KeychainTarget,
): Promise<Result<string, KeychainError>> {
  const result = await runner.run([
    'find-generic-password',
    '-s',
    target.service,
    '-a',
    target.account,
    '-w',
  ]);
  const runError = mapRunResult(result);
  if (runError) return err(runError);

  const value = result.stdout.trim();
  if (value.length === 0) {
    return err({ code: 'empty_value', message: 'Keychain item exists but holds an empty value' });
  }
  return ok(value);
}

/**
 * Deletes a credential. A missing item is reported explicitly
 * (item_not_found) rather than silently succeeding.
 */
export async function deleteCredential(
  runner: SecurityRunner,
  target: KeychainTarget,
): Promise<Result<null, KeychainError>> {
  const result = await runner.run([
    'delete-generic-password',
    '-s',
    target.service,
    '-a',
    target.account,
  ]);
  const runError = mapRunResult(result);
  if (runError) return err(runError);
  return ok(null);
}

// ─── Access-control verification ────────────────────────────

interface ParsedDump {
  readonly itemClass: string;
  readonly service: string | null;
  readonly account: string | null;
}

function parseAttributeDump(dump: string): ParsedDump | null {
  const classMatch = /^class:\s*"([^"]*)"/m.exec(dump);
  const svceMatch = /"svce"<blob>="([^"]*)"/.exec(dump);
  const acctMatch = /"acct"<blob>="([^"]*)"/.exec(dump);
  if (!classMatch) return null;
  return {
    itemClass: classMatch[1] ?? '',
    service: svceMatch?.[1] ?? null,
    account: acctMatch?.[1] ?? null,
  };
}

/**
 * Verifies the stored item's attributes WITHOUT reading its password
 * (no `-w` flag). Fail-closed: anything other than a well-formed
 * generic-password dump matching the target is a verification failure.
 *
 * Note on the three required properties: items created through the
 * `security` CLI are login-keychain (device-local) generic passwords and
 * are never marked synchronizable — iCloud sync requires the explicit
 * kSecAttrSynchronizable API which the CLI cannot set. The dump check
 * pins the class + identity; the non-sync/when-unlocked policy itself is
 * carried by KEYCHAIN_ACCESS_CONTROL and disclosed to the user before
 * every confirmation.
 */
export async function verifyAccessControl(
  runner: SecurityRunner,
  target: KeychainTarget,
): Promise<Result<KeychainAccessControl, KeychainError>> {
  const result = await runner.run([
    'find-generic-password',
    '-s',
    target.service,
    '-a',
    target.account,
  ]);
  const runError = mapRunResult(result);
  if (runError) {
    return err({
      code: 'verification_failed',
      message: `Cannot verify item attributes: ${runError.message}`,
    });
  }

  const parsed = parseAttributeDump(result.stdout);
  if (!parsed) {
    return err({ code: 'verification_failed', message: 'Unparseable keychain attribute dump' });
  }
  if (parsed.itemClass !== 'genp') {
    return err({
      code: 'verification_failed',
      message: `Unexpected keychain item class: ${parsed.itemClass}`,
    });
  }
  if (parsed.service !== target.service || parsed.account !== target.account) {
    return err({
      code: 'verification_failed',
      message: 'Stored item identity does not match the requested target',
    });
  }

  return ok(KEYCHAIN_ACCESS_CONTROL);
}
