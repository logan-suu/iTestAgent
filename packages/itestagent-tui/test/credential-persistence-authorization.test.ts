/**
 * Credential persistence authorization tests (guide §6.4).
 *
 * Contract: Keychain persistence is a high-risk operation. Every first save
 * must present scope/service/account/revocation and obtain an explicit
 * interactive confirmation. Covered paths:
 *   - 拒绝 (deny):  wrong/missing confirmation → no save, no process spawned.
 *   - 允许 (allow): exact confirmation → single-use authorization → one save.
 *   - 撤销 (revoke): explicit revocation blocks further saves this session.
 */
import { describe, expect, it } from 'bun:test';
import {
  type KeychainTarget,
  PERSISTENCE_CONFIRMATION_TOKEN,
  type PersistenceAuthorization,
  type SecurityRunResult,
  type SecurityRunner,
  authorizePersistence,
  revokePersistence,
  saveCredential,
} from '../src/keychain-persistence.js';
import {
  type SetupControllerState,
  createInitialSetupState,
  setupReducer,
} from '../src/tui-setup-controller.js';

// ─── Test helpers ───────────────────────────────────────────

const TARGET: KeychainTarget = { service: 'itestagent/openai_api_key', account: 'itestagent' };
const FAKE_SECRET = 'itestagent-fake-secret-B28-auth-77aa';

/** Attribute dump fixture shaped like real `security find-generic-password` output. */
function attributeDump(target: KeychainTarget): string {
  return [
    'keychain: "/Users/fake/Library/Keychains/login.keychain-db"',
    'version: 512',
    'class: "genp"',
    'attributes:',
    '    0x00000007 <blob>="itestagent"',
    '    "acct"<blob>="${acct}"',
    '    "svce"<blob>="${svce}"',
    '    "cdat"<timedate>="2026-01-01 00:00:00 +0000"',
  ]
    .join('\n')
    .replace('${acct}', target.account)
    .replace('${svce}', target.service);
}

function successRunner(): SecurityRunner & { calls: number } {
  return {
    calls: 0,
    async run(_args: readonly string[]): Promise<SecurityRunResult> {
      this.calls += 1;
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    },
  };
}

/**
 * Runner that answers add-generic-password with success and the verify step
 * (find-generic-password without -w) with a well-formed dump.
 */
function verifyingRunner(target: KeychainTarget): SecurityRunner & { calls: number } {
  return {
    calls: 0,
    async run(args: readonly string[]): Promise<SecurityRunResult> {
      this.calls += 1;
      const isVerify = args.includes('find-generic-password') && !args.includes('-w');
      return {
        exitCode: 0,
        stdout: isVerify ? attributeDump(target) : '',
        stderr: '',
        timedOut: false,
      };
    },
  };
}

function authorizedNow(): PersistenceAuthorization {
  const result = authorizePersistence(PERSISTENCE_CONFIRMATION_TOKEN, TARGET, 1_000);
  if (!result.ok) throw new Error('authorization fixture failed');
  return result.value;
}

// ─── authorizePersistence: allow / deny ─────────────────────

describe('authorizePersistence', () => {
  it('grants authorization on the exact confirmation token (allow)', () => {
    const result = authorizePersistence(PERSISTENCE_CONFIRMATION_TOKEN, TARGET, 1234);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.granted).toBe(true);
    expect(result.value.scope).toBe('device-local');
    expect(result.value.service).toBe(TARGET.service);
    expect(result.value.account).toBe(TARGET.account);
    expect(result.value.confirmedAt).toBe(1234);
  });

  it('rejects near-miss confirmations (deny)', () => {
    for (const bad of ['', ' ', 'save ', ' save', 'Save', 'SAVE', 'yes', 'y', 'confirm']) {
      const result = authorizePersistence(bad, TARGET);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects an empty service or account', () => {
    expect(
      authorizePersistence(PERSISTENCE_CONFIRMATION_TOKEN, { service: '', account: 'a' }).ok,
    ).toBe(false);
    expect(
      authorizePersistence(PERSISTENCE_CONFIRMATION_TOKEN, { service: 's', account: '' }).ok,
    ).toBe(false);
  });
});

// ─── saveCredential enforces authorization structurally ─────

describe('saveCredential authorization enforcement', () => {
  it('refuses to save without authorization and never spawns a process (deny)', async () => {
    const runner = successRunner();
    const result = await saveCredential(runner, TARGET, FAKE_SECRET, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_authorized');
    }
    expect(runner.calls).toBe(0);
  });

  it('saves exactly once with a valid single-use authorization (allow)', async () => {
    const runner = verifyingRunner(TARGET);
    const auth = authorizedNow();
    const result = await saveCredential(runner, TARGET, FAKE_SECRET, auth);
    expect(result.ok).toBe(true);
    // One add-generic-password call + one access-control verification call.
    expect(runner.calls).toBe(2);
  });

  it('consumes the authorization after one save (single-use)', async () => {
    const runner = verifyingRunner(TARGET);
    const auth = authorizedNow();
    await saveCredential(runner, TARGET, FAKE_SECRET, auth);
    const second = await saveCredential(runner, TARGET, FAKE_SECRET, auth);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('authorization_consumed');
    }
    expect(runner.calls).toBe(2); // no additional process spawned
  });

  it('refuses to save after explicit revocation (revoke)', async () => {
    const runner = verifyingRunner(TARGET);
    const auth = authorizedNow();
    revokePersistence(auth);
    const result = await saveCredential(runner, TARGET, FAKE_SECRET, auth);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_authorized');
    }
    expect(runner.calls).toBe(0);
  });

  it('rejects an authorization issued for a different target', async () => {
    const runner = verifyingRunner(TARGET);
    const otherTarget: KeychainTarget = { service: 'other/svc', account: 'other-acct' };
    const result = await saveCredential(runner, otherTarget, FAKE_SECRET, authorizedNow());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_authorized');
    }
    expect(runner.calls).toBe(0);
  });
});

// ─── Setup controller flow: deny / allow / revoke ───────────

function stateAtApiKeyStep(draft: string): SetupControllerState {
  let s = createInitialSetupState();
  s = setupReducer(s, { type: 'start' }).state;
  s = setupReducer(s, { type: 'input', text: 'deepseek' }).state;
  s = setupReducer(s, { type: 'submit' }).state; // provider → base_url
  s = setupReducer(s, { type: 'submit' }).state; // base_url (empty allowed) → model
  s = setupReducer(s, { type: 'submit' }).state; // model (empty allowed) → api_key
  s = setupReducer(s, { type: 'input', text: draft }).state;
  return s;
}

describe('setup controller persistence flow', () => {
  it('choose_remember shows scope/service/account/revocation notice but emits NO effect yet', () => {
    const { state, effects } = setupReducer(stateAtApiKeyStep(FAKE_SECRET), {
      type: 'choose_remember',
    });
    expect(effects).toHaveLength(0);
    expect(state.step).toBe('persistence_decision');
    expect(state.awaitingConfirmation).toBe(true);
    expect(state.persistenceNotice).not.toBeNull();
    const notice = state.persistenceNotice?.join('\n') ?? '';
    expect(notice).toContain('device-local');
    expect(notice).toContain(TARGET.service);
    expect(notice).toContain(TARGET.account);
    expect(notice).toContain('delete-generic-password');
    // The notice must never contain the secret itself.
    expect(notice).not.toContain(FAKE_SECRET);
  });

  it('confirm_persistence emits exactly one save effect carrying the authorization (allow)', () => {
    const stepped = setupReducer(stateAtApiKeyStep(FAKE_SECRET), { type: 'choose_remember' });
    const { state, effects } = setupReducer(stepped.state, { type: 'confirm_persistence' });
    expect(effects).toHaveLength(1);
    const effect = effects[0];
    expect(effect?.kind).toBe('save_to_keychain');
    if (effect?.kind !== 'save_to_keychain') return;
    expect(effect.target).toEqual(TARGET);
    expect(effect.value).toBe(FAKE_SECRET);
    expect(effect.authorization.granted).toBe(true);
    // Secret is cleared from controller memory once handed to the effect.
    expect(state.apiKeyDraft).toBe('');
    expect(state.step).toBe('complete');
    expect(state.outcome).toBe('saved_to_keychain');
  });

  it('deny_persistence keeps the credential memory-only and emits nothing (deny)', () => {
    const stepped = setupReducer(stateAtApiKeyStep(FAKE_SECRET), { type: 'choose_remember' });
    const { state, effects } = setupReducer(stepped.state, { type: 'deny_persistence' });
    expect(effects).toHaveLength(0);
    expect(state.step).toBe('complete');
    expect(state.outcome).toBe('denied');
    expect(state.apiKeyDraft).toBe('');
    expect(state.awaitingConfirmation).toBe(false);
  });

  it('confirm without a pending notice is a fail-closed no-op', () => {
    const { state, effects } = setupReducer(stateAtApiKeyStep(FAKE_SECRET), {
      type: 'confirm_persistence',
    });
    expect(effects).toHaveLength(0);
    expect(state.step).toBe('api_key');
  });

  it('revoke_persistence cancels a pending confirmation and blocks later saves (revoke)', () => {
    const stepped = setupReducer(stateAtApiKeyStep(FAKE_SECRET), { type: 'choose_remember' });
    const revoked = setupReducer(stepped.state, { type: 'revoke_persistence' });
    expect(revoked.effects).toHaveLength(0);
    expect(revoked.state.revokedThisSession).toBe(true);
    expect(revoked.state.outcome).toBe('revoked');

    // A later remember attempt in the same session must be refused.
    const again = setupReducer(revoked.state, { type: 'choose_remember' });
    expect(again.effects).toHaveLength(0);
    expect(again.state.awaitingConfirmation).toBe(false);
    expect(again.state.error).not.toBe('');
  });

  it('saved outcome then revoke marks the session revoked without new effects', () => {
    const stepped = setupReducer(stateAtApiKeyStep(FAKE_SECRET), { type: 'choose_remember' });
    const saved = setupReducer(stepped.state, { type: 'confirm_persistence' });
    const after = setupReducer(saved.state, { type: 'revoke_persistence' });
    expect(after.effects).toHaveLength(0);
    expect(after.state.revokedThisSession).toBe(true);
  });
});
