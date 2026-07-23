/**
 * TuiShell credential prompt mode reducer tests.
 *
 * US-10.2 AC1-AC5: enter_credential_prompt, credential_input, credential_submit,
 * credential_skip, credential_toggle_remember, credential_confirm_all.
 * Pattern follows tui-shell-plan.test.ts.
 */
import { describe, expect, it } from 'bun:test';
import type { CredentialRequest, CredentialResponse } from 'itestagent-contracts';
import { type TuiShellState, createInitialState, tuiShellReducer } from '../src/tui-shell.js';

// ─── Test helpers ───────────────────────────────────────────

function makeRequests(): CredentialRequest[] {
  return [
    { key: 'login_username', label: 'Login Username', kind: 'text', required: true },
    {
      key: 'login_password',
      label: 'Login Password',
      kind: 'password',
      required: true,
      helpText: 'Your account password',
    },
    { key: 'api_token', label: 'API Token', kind: 'token', required: false, helpText: 'Optional' },
  ];
}

function enterCredentialPrompt(state: TuiShellState, requests: CredentialRequest[]): TuiShellState {
  return tuiShellReducer(state, { type: 'enter_credential_prompt', requests });
}

// ─── enter_credential_prompt ─────────────────────────────────

describe('enter_credential_prompt event', () => {
  it('switches mode to credential_prompt', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const next = tuiShellReducer(state, { type: 'enter_credential_prompt', requests });
    expect(next.mode).toBe('credential_prompt');
  });

  it('stores credential requests and resets index', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const next = tuiShellReducer(state, { type: 'enter_credential_prompt', requests });
    expect(next.credentialRequests).toEqual(requests);
    expect(next.credentialIndex).toBe(0);
    expect(next.credentialInputDraft).toBe('');
    expect(next.credentialResponses.size).toBe(0);
    expect(next.credentialCompleted).toBe(false);
  });

  it('resets remember toggled state', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const next = tuiShellReducer(state, { type: 'enter_credential_prompt', requests });
    expect(next.credentialRememberToggled).toBe(false);
  });
});

// ─── exit_credential_prompt ──────────────────────────────────

describe('exit_credential_prompt event', () => {
  it('switches mode back to chat', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const next = tuiShellReducer(entered, { type: 'exit_credential_prompt' });
    expect(next.mode).toBe('chat');
  });

  it('preserves credential responses for engine access', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const typed = tuiShellReducer(entered, { type: 'credential_input', text: 'myuser' });
    const submitted = tuiShellReducer(typed, { type: 'credential_submit' });
    const exited = tuiShellReducer(submitted, { type: 'exit_credential_prompt' });
    expect(exited.credentialResponses.size).toBe(1);
  });
});

// ─── credential_input ────────────────────────────────────────

describe('credential_input event', () => {
  it('updates input draft', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const next = tuiShellReducer(entered, { type: 'credential_input', text: 'mypassword' });
    expect(next.credentialInputDraft).toBe('mypassword');
  });

  it('stores plain text for password kind in draft (masking is render-time)', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const next = tuiShellReducer(entered, { type: 'credential_input', text: 'secret123' });
    // AC4: draft is stored plain in state, rendering masks it
    expect(next.credentialInputDraft).toBe('secret123');
  });

  it('replaces previous draft on new input', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const first = tuiShellReducer(entered, { type: 'credential_input', text: 'old' });
    const second = tuiShellReducer(first, { type: 'credential_input', text: 'new' });
    expect(second.credentialInputDraft).toBe('new');
  });
});

// ─── credential_submit ───────────────────────────────────────

describe('credential_submit event', () => {
  it('creates response with provided status and advances index', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const typed = tuiShellReducer(entered, { type: 'credential_input', text: 'myuser' });
    const submitted = tuiShellReducer(typed, { type: 'credential_submit' });
    const resp = submitted.credentialResponses.get('login_username');
    expect(resp).toBeDefined();
    expect(resp?.status).toBe('provided');
    expect(resp?.value).toBe('myuser');
    expect(submitted.credentialIndex).toBe(1);
    expect(submitted.credentialInputDraft).toBe('');
  });

  it('sets remembered=true when toggle was active', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const toggled = tuiShellReducer(entered, { type: 'credential_toggle_remember' });
    const typed = tuiShellReducer(toggled, { type: 'credential_input', text: 'mypass' });
    const submitted = tuiShellReducer(typed, { type: 'credential_submit' });
    const resp = submitted.credentialResponses.get('login_username');
    expect(resp?.remembered).toBe(true);
  });

  it('sets remembered=false when toggle is off', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const typed = tuiShellReducer(entered, { type: 'credential_input', text: 'mypass' });
    const submitted = tuiShellReducer(typed, { type: 'credential_submit' });
    const resp = submitted.credentialResponses.get('login_username');
    expect(resp?.remembered).toBe(false);
  });
});

// ─── credential_skip ─────────────────────────────────────────

describe('credential_skip event', () => {
  it('marks response as skipped for non-required credential', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    // Navigate to index 2 (api_token, required=false)
    const atIndex2 = tuiShellReducer(tuiShellReducer(entered, { type: 'credential_submit' }), {
      type: 'credential_submit',
    });
    const skipped = tuiShellReducer(atIndex2, { type: 'credential_skip' });
    const resp = skipped.credentialResponses.get('api_token');
    expect(resp).toBeDefined();
    expect(resp?.status).toBe('skipped');
  });

  it('advances index after skip', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    // Submit first, then skip second
    const typed = tuiShellReducer(entered, { type: 'credential_input', text: 'user' });
    const submitted = tuiShellReducer(typed, { type: 'credential_submit' });
    // Now at index 1 (password, required=true)
    const skipped = tuiShellReducer(submitted, { type: 'credential_skip' });
    expect(skipped.credentialIndex).toBe(2);
    const resp = skipped.credentialResponses.get('login_password');
    expect(resp?.status).toBe('skipped');
  });

  it('sets completed when all credentials are done after skip', () => {
    const state = createInitialState('/test');
    const firstReq = makeRequests()[0];
    if (!firstReq) throw new Error('no request');
    const requests: CredentialRequest[] = [firstReq];
    const entered = enterCredentialPrompt(state, requests);
    const skipped = tuiShellReducer(entered, { type: 'credential_skip' });
    expect(skipped.credentialCompleted).toBe(true);
  });
});

// ─── credential_toggle_remember ───────────────────────────────

describe('credential_toggle_remember event', () => {
  it('toggles remember from false to true', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const toggled = tuiShellReducer(entered, { type: 'credential_toggle_remember' });
    expect(toggled.credentialRememberToggled).toBe(true);
  });

  it('toggles remember from true back to false', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const toggledOnce = tuiShellReducer(entered, { type: 'credential_toggle_remember' });
    const toggledTwice = tuiShellReducer(toggledOnce, { type: 'credential_toggle_remember' });
    expect(toggledTwice.credentialRememberToggled).toBe(false);
  });
});

// ─── credential_confirm_all ──────────────────────────────────

describe('credential_confirm_all event', () => {
  it('sets credentialCompleted to true', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const next = tuiShellReducer(entered, { type: 'credential_confirm_all' });
    expect(next.credentialCompleted).toBe(true);
  });

  it('switches mode back to chat', () => {
    const state = createInitialState('/test');
    const requests = makeRequests();
    const entered = enterCredentialPrompt(state, requests);
    const next = tuiShellReducer(entered, { type: 'credential_confirm_all' });
    expect(next.mode).toBe('chat');
  });
});

// ─── Default state ──────────────────────────────────────────

describe('default state fields for credential prompt', () => {
  it('createInitialState has empty credential fields and chat mode', () => {
    const state = createInitialState('/test');
    expect(state.mode).toBe('chat');
    expect(state.credentialRequests).toEqual([]);
    expect(state.credentialIndex).toBe(0);
    expect(state.credentialInputDraft).toBe('');
    expect(state.credentialResponses.size).toBe(0);
    expect(state.credentialCompleted).toBe(false);
    expect(state.credentialRememberToggled).toBe(false);
  });
});
