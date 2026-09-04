/**
 * config-secret-safety.test.ts — B17 config command safety flows (promotion
 * guide §11.3 "CLI safety/config"; R6/R7).
 *
 * Locks the extracted command handlers behind an injectable context:
 *   - set-secret requires a Keychain-backed store AND explicit confirmation
 *     AND reads the value through the hidden-input reader — plaintext never
 *     reaches stdout/stderr;
 *   - get-secret displays a credential only after explicit confirmation;
 *   - delete-secret confirms before removal;
 *   - every abort surfaces as a typed PublicCliError ('Aborted.').
 */
import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  type ConfigCommandContext,
  runConfigDeleteSecret,
  runConfigGetSecret,
  runConfigRevokeDeny,
  runConfigSetSecret,
  runConfigShow,
} from '../src/commands/config.js';
import { KeychainSecretStore } from '../src/config/keychain-secret-store.js';
import { PublicCliError } from '../src/public-error.js';

/** Instance passes the instanceof check without touching the real Keychain. */
function fakeKeychainStore() {
  const stored = new Map<string, string>();
  const calls: string[] = [];
  const store = Object.create(KeychainSecretStore.prototype) as unknown as {
    set(key: string, value: string): Promise<void>;
    get(key: string): Promise<string | null>;
    delete(key: string): Promise<void>;
  };
  store.set = async (key, value) => {
    stored.set(key, value);
    calls.push(`set:${key}`);
  };
  store.get = async (key) => stored.get(key) ?? null;
  store.delete = async (key) => {
    stored.delete(key);
    calls.push(`delete:${key}`);
  };
  return { store: store as unknown as KeychainSecretStore, stored, calls };
}

function makeCtx(overrides: Partial<ConfigCommandContext> = {}): {
  ctx: ConfigCommandContext;
  outText: () => string;
  errText: () => string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let outBuffer = '';
  let errBuffer = '';
  stdout.on('data', (chunk: Buffer | string) => {
    outBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  });
  stderr.on('data', (chunk: Buffer | string) => {
    errBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  });
  return {
    ctx: { stdout, stderr, ...overrides },
    outText: () => outBuffer,
    errText: () => errBuffer,
  };
}

const SECRET = 's3cret-fixture-value-b17';
const KEY = 'api-key';

async function expectPublicCliError(promise: Promise<unknown>, messagePart: string): Promise<void> {
  try {
    await promise;
    throw new Error('expected the handler to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(PublicCliError);
    expect((error as PublicCliError).message).toContain(messagePart);
  }
}

describe('runConfigSetSecret', () => {
  it('stores via hidden input and never echoes plaintext on success', async () => {
    const { store } = fakeKeychainStore();
    const { ctx, outText } = makeCtx({
      createSecretStoreFn: () => store,
      confirmFn: async () => 'yes',
      readHiddenFn: async () => SECRET,
    });

    await runConfigSetSecret(KEY, ctx);
    expect(outText()).toContain(`Credential "${KEY}" stored`);
    expect(outText()).not.toContain(SECRET);
  });

  it('aborts with a typed error when confirmation is declined', async () => {
    const { store } = fakeKeychainStore();
    const { ctx } = makeCtx({
      createSecretStoreFn: () => store,
      confirmFn: async () => 'no',
      readHiddenFn: async () => SECRET,
    });
    await expectPublicCliError(runConfigSetSecret(KEY, ctx), 'Aborted');
  });

  it('refuses non-Keychain stores outright', async () => {
    const plainStore = { set: async () => {}, get: async () => null, delete: async () => {} };
    const { ctx } = makeCtx({
      createSecretStoreFn: () => plainStore as unknown as KeychainSecretStore,
      confirmFn: async () => 'yes',
      readHiddenFn: async () => SECRET,
    });
    await expectPublicCliError(runConfigSetSecret(KEY, ctx), 'only available on macOS');
  });

  it('rejects an empty secret value after confirmation', async () => {
    const { store } = fakeKeychainStore();
    const { ctx } = makeCtx({
      createSecretStoreFn: () => store,
      confirmFn: async () => 'yes',
      readHiddenFn: async () => '',
    });
    await expectPublicCliError(runConfigSetSecret(KEY, ctx), 'empty value');
  });
});

describe('runConfigGetSecret', () => {
  it('prints the stored value only after explicit confirmation', async () => {
    const { store } = fakeKeychainStore();
    await store.set(KEY, SECRET);
    const { ctx, outText } = makeCtx({
      createSecretStoreFn: () => store,
      confirmFn: async () => 'yes',
    });
    await runConfigGetSecret(KEY, ctx);
    expect(outText().trim()).toBe(SECRET);
  });

  it('aborts when confirmation is declined', async () => {
    const { store } = fakeKeychainStore();
    const { ctx } = makeCtx({
      createSecretStoreFn: () => store,
      confirmFn: async () => 'no',
    });
    await expectPublicCliError(runConfigGetSecret(KEY, ctx), 'Aborted');
  });

  it('reports a missing credential as a typed failure', async () => {
    const { store } = fakeKeychainStore();
    const { ctx } = makeCtx({
      createSecretStoreFn: () => store,
      confirmFn: async () => 'yes',
    });
    await expectPublicCliError(runConfigGetSecret('missing-key', ctx), 'not found');
  });
});

describe('runConfigDeleteSecret', () => {
  it('removes the credential after confirmation', async () => {
    const { store, calls } = fakeKeychainStore();
    await store.set(KEY, SECRET);
    const { ctx, outText } = makeCtx({
      createSecretStoreFn: () => store,
      confirmFn: async () => 'yes',
    });
    await runConfigDeleteSecret(KEY, ctx);
    expect(calls).toContain(`delete:${KEY}`);
    expect(outText()).toContain('removed');
  });

  it('aborts when confirmation is declined', async () => {
    const { store } = fakeKeychainStore();
    const { ctx } = makeCtx({
      createSecretStoreFn: () => store,
      confirmFn: async () => 'no',
    });
    await expectPublicCliError(runConfigDeleteSecret(KEY, ctx), 'Aborted');
  });
});

describe('runConfigRevokeDeny', () => {
  it('does not broaden permissions until the user confirms', async () => {
    let revoked = false;
    const { ctx } = makeCtx({
      confirmFn: async () => 'no',
      revokeDeniedRuleFn: async () => {
        revoked = true;
        return true;
      },
    });
    await expectPublicCliError(runConfigRevokeDeny('delete', '*', ctx), 'Aborted');
    expect(revoked).toBe(false);
  });

  it('revokes the exact deny after confirmation', async () => {
    const calls: string[] = [];
    const { ctx, outText } = makeCtx({
      confirmFn: async () => 'yes',
      revokeDeniedRuleFn: async (action, resource) => {
        calls.push(`${action}:${resource}`);
        return true;
      },
    });
    await runConfigRevokeDeny('delete', 'account', ctx);
    expect(calls).toEqual(['delete:account']);
    expect(outText()).toContain('Revoked persistent deny');
  });
});

describe('runConfigShow', () => {
  it('writes the effective config to stdout and sources to stderr', async () => {
    const fixture = {
      config: { model: { provider: 'deepseek' }, devices: {} },
      sources: [
        { path: '/fixture/global.jsonc', exists: true },
        { path: '/fixture/project.jsonc', exists: false },
      ],
    };
    const { ctx, outText, errText } = makeCtx({
      loadConfigFn: async () =>
        fixture as unknown as Awaited<
          ReturnType<NonNullable<ConfigCommandContext['loadConfigFn']>>
        >,
    });
    await runConfigShow(ctx);
    expect(outText()).toContain('"deepseek"');
    expect(errText()).toContain('/fixture/global.jsonc');
    expect(errText()).toContain('/fixture/project.jsonc');
  });

  it('skips the credentials branch when no apiKeyRef is configured', async () => {
    let credentialLookups = 0;
    const { ctx } = makeCtx({
      loadConfigFn: async () =>
        ({
          config: { model: {} },
          sources: [],
        }) as unknown as Awaited<ReturnType<NonNullable<ConfigCommandContext['loadConfigFn']>>>,
      createSecretStoreFn: () => {
        credentialLookups++;
        return fakeKeychainStore().store;
      },
    });
    await runConfigShow(ctx);
    expect(credentialLookups).toBe(0);
  });
});
