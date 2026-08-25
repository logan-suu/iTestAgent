import { DEFAULT_API_KEY_TARGET } from './api-key-loader.js';
/**
 * TUI setup controller — framework-independent state machine for the
 * first-run setup wizard (provider → base URL → model → API key →
 * persistence decision).
 *
 * Guide §6.4 credential persistence contract:
 *   - The API key draft is memory-only by default.
 *   - Keychain persistence requires an explicit interactive confirmation:
 *     the controller first presents scope/service/account/revocation
 *     (persistence_notice), then only emits a save effect after
 *     confirm_persistence. Deny keeps the credential memory-only.
 *   - Revocation is sticky for the session: once revoked, no further saves
 *     may be requested without restarting the wizard.
 *
 * The reducer is pure: effects are returned, never executed here. The
 * shell executes save_to_keychain effects through keychain-persistence.
 */
import { formatPersistenceAuthorizationNotice } from './credential-prompt.js';
import {
  type KeychainTarget,
  PERSISTENCE_CONFIRMATION_TOKEN,
  type PersistenceAuthorization,
  authorizePersistence,
} from './keychain-persistence.js';

// ─── State ──────────────────────────────────────────────────

export type SetupStepId =
  | 'provider'
  | 'base_url'
  | 'model'
  | 'api_key'
  | 'persistence_decision'
  | 'complete';

/** Terminal disposition of the API key for this session. */
export type SetupOutcome = 'pending' | 'saved_to_keychain' | 'session_only' | 'denied' | 'revoked';

export interface SetupControllerState {
  readonly step: SetupStepId;
  /** Current text input draft for the active step. */
  readonly draft: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
  /**
   * Memory-only API key draft. Cleared as soon as the value is handed to a
   * save effect or the flow completes without persistence.
   */
  readonly apiKeyDraft: string;
  /** Notice lines shown while awaiting explicit persistence confirmation. */
  readonly persistenceNotice: readonly string[] | null;
  readonly awaitingConfirmation: boolean;
  /** Sticky session flag: user revoked Keychain persistence. */
  readonly revokedThisSession: boolean;
  readonly error: string;
  readonly outcome: SetupOutcome;
}

export function createInitialSetupState(): SetupControllerState {
  return {
    step: 'provider',
    draft: '',
    provider: '',
    baseUrl: '',
    model: '',
    apiKeyDraft: '',
    persistenceNotice: null,
    awaitingConfirmation: false,
    revokedThisSession: false,
    error: '',
    outcome: 'pending',
  };
}

// ─── Events & effects ───────────────────────────────────────

export type SetupEvent =
  | { readonly type: 'start' }
  | { readonly type: 'input'; readonly text: string }
  | { readonly type: 'submit' }
  | { readonly type: 'skip' }
  | { readonly type: 'choose_remember' }
  | { readonly type: 'confirm_persistence' }
  | { readonly type: 'deny_persistence' }
  | { readonly type: 'revoke_persistence' };

/**
 * The ONLY channel through which a secret leaves controller memory: a
 * save_to_keychain effect carrying a live single-use authorization. The
 * shell must execute it via saveCredential() immediately and discard it.
 */
export type SetupEffect = {
  readonly kind: 'save_to_keychain';
  readonly target: KeychainTarget;
  readonly value: string;
  readonly authorization: PersistenceAuthorization;
};

export interface SetupTransition {
  readonly state: SetupControllerState;
  readonly effects: readonly SetupEffect[];
}

const SETUP_TARGET: KeychainTarget = DEFAULT_API_KEY_TARGET;

// ─── Validation ─────────────────────────────────────────────

function validateStep(state: SetupControllerState): string | null {
  const value = state.draft.trim();
  switch (state.step) {
    case 'provider':
      return value.length > 0 ? null : 'Provider is required';
    case 'base_url':
      if (value.length === 0) return null; // optional, default applies
      return /^https?:\/\/\S+$/.test(value) ? null : 'Base URL must start with http:// or https://';
    case 'model':
      return null; // optional, default applies
    case 'api_key':
      return value.length > 0 ? null : 'API key is required';
    default:
      return null;
  }
}

function commitField(state: SetupControllerState): SetupControllerState {
  const value = state.draft.trim();
  switch (state.step) {
    case 'provider':
      return { ...state, provider: value };
    case 'base_url':
      return { ...state, baseUrl: value };
    case 'model':
      return { ...state, model: value };
    case 'api_key':
      return { ...state, apiKeyDraft: value };
    default:
      return state;
  }
}

function nextStep(step: SetupStepId): SetupStepId {
  switch (step) {
    case 'provider':
      return 'base_url';
    case 'base_url':
      return 'model';
    case 'model':
      return 'api_key';
    default:
      return step;
  }
}

// ─── Reducer ────────────────────────────────────────────────

export function setupReducer(state: SetupControllerState, event: SetupEvent): SetupTransition {
  switch (event.type) {
    case 'start':
      return {
        state: { ...createInitialSetupState(), revokedThisSession: state.revokedThisSession },
        effects: [],
      };

    case 'input':
      if (state.step === 'complete' || state.step === 'persistence_decision')
        return { state, effects: [] };
      return { state: { ...state, draft: event.text, error: '' }, effects: [] };

    case 'submit': {
      if (state.step === 'complete' || state.step === 'persistence_decision') {
        return { state, effects: [] };
      }
      const validationError = validateStep(state);
      if (validationError) {
        return { state: { ...state, error: validationError }, effects: [] };
      }
      const committed = commitField(state);
      return {
        state: { ...committed, draft: '', error: '', step: nextStep(state.step) },
        effects: [],
      };
    }

    case 'skip': {
      // Only the optional steps may be skipped.
      if (state.step === 'base_url' || state.step === 'model') {
        return {
          state: { ...state, draft: '', error: '', step: nextStep(state.step) },
          effects: [],
        };
      }
      return { state, effects: [] };
    }

    case 'choose_remember': {
      if (state.revokedThisSession) {
        return {
          state: {
            ...state,
            error: 'Keychain persistence was revoked for this session',
          },
          effects: [],
        };
      }
      if (state.step !== 'api_key') {
        return { state, effects: [] };
      }
      const value = (state.apiKeyDraft.trim().length > 0 ? state.apiKeyDraft : state.draft).trim();
      if (value.length === 0) {
        return { state: { ...state, error: 'API key is required' }, effects: [] };
      }
      return {
        state: {
          ...state,
          apiKeyDraft: value,
          draft: '',
          step: 'persistence_decision',
          awaitingConfirmation: true,
          persistenceNotice: formatPersistenceAuthorizationNotice(SETUP_TARGET),
          error: '',
        },
        effects: [],
      };
    }

    case 'confirm_persistence': {
      if (!state.awaitingConfirmation || state.step !== 'persistence_decision') {
        // Fail-closed: confirmation without a presented notice is a no-op.
        return { state, effects: [] };
      }
      const authorized = authorizePersistence(PERSISTENCE_CONFIRMATION_TOKEN, SETUP_TARGET);
      if (!authorized.ok) {
        return {
          state: { ...state, error: authorized.error.message },
          effects: [],
        };
      }
      return {
        state: {
          ...state,
          step: 'complete',
          outcome: 'saved_to_keychain',
          awaitingConfirmation: false,
          persistenceNotice: null,
          apiKeyDraft: '', // handed to the effect below; cleared from memory
          error: '',
        },
        effects: [
          {
            kind: 'save_to_keychain',
            target: SETUP_TARGET,
            value: state.apiKeyDraft,
            authorization: authorized.value,
          },
        ],
      };
    }

    case 'deny_persistence': {
      if (!state.awaitingConfirmation) return { state, effects: [] };
      return {
        state: {
          ...state,
          step: 'complete',
          outcome: 'denied',
          awaitingConfirmation: false,
          persistenceNotice: null,
          apiKeyDraft: '',
          error: '',
        },
        effects: [],
      };
    }

    case 'revoke_persistence': {
      const wasAwaiting = state.awaitingConfirmation;
      return {
        state: {
          ...state,
          revokedThisSession: true,
          awaitingConfirmation: false,
          persistenceNotice: null,
          apiKeyDraft: wasAwaiting ? '' : state.apiKeyDraft,
          step: wasAwaiting ? 'complete' : state.step,
          outcome: wasAwaiting ? 'revoked' : state.outcome,
          error: '',
        },
        effects: [],
      };
    }
  }
}
