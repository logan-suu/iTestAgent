import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parseIntentResult, parseTestPlan } from 'itestagent-contracts';
import { assertProviderUrl } from 'itestagent-engine';
import type { CandidateLink } from 'itestagent-project-analyzer';
import { DEFAULT_API_KEY_TARGET } from './api-key-loader.js';
import { formatPersistenceAuthorizationNotice } from './credential-prompt.js';
import {
  PERSISTENCE_CONFIRMATION_TOKEN,
  authorizePersistence,
  createSecurityRunner,
  saveCredential,
} from './keychain-persistence.js';
import { createConfiguredRenderer } from './renderer-factory.js';
import { loadTuiRuntimeConfig } from './runtime-config.js';
import {
  type TuiShellEvent,
  type TuiShellState,
  createInitialState,
  tuiShellReducer,
} from './tui-shell.js';

// ── First-run detection ─────────────────────────────────────

function isFirstRun(): boolean {
  return !existsSync(resolve(homedir(), '.itestagent', 'config', 'itestagent.jsonc'));
}

async function saveConfig(baseUrl: string, model: string): Promise<void> {
  const dir = resolve(homedir(), '.itestagent', 'config');
  const path = resolve(dir, 'itestagent.jsonc');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify(
      {
        schemaVersion: '1.0',
        model: { provider: 'openai', baseURL: baseUrl, apiKeyRef: 'openai_api_key', model },
        device: { allowCrossTargetFallback: false },
        tui: { framework: 'auto' },
      },
      null,
      2,
    ),
    { encoding: 'utf8', mode: 0o600 },
  );
}

// ── TUI entry ───────────────────────────────────────────────

export async function startTui(workspace?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('iTestAgent TUI requires a terminal.');
    console.log("Run 'itestagent --help' for available commands.");
    return;
  }

  const ws = workspace ?? process.cwd();
  const needsSetup = isFirstRun();
  const runtimeConfig = loadTuiRuntimeConfig({ workspace: ws });
  if (needsSetup && !['auto', 'ansi'].includes(runtimeConfig.tui.framework)) {
    throw new Error(
      `renderer_unavailable: ${runtimeConfig.tui.framework}: secure masked first-run setup requires tui.framework=auto or ansi`,
    );
  }
  const createdRenderer = await createConfiguredRenderer(
    needsSetup ? 'ansi' : runtimeConfig.tui.framework,
  );
  const selectedRenderer = needsSetup
    ? {
        ...createdRenderer,
        preference: runtimeConfig.tui.framework,
        explicit: runtimeConfig.tui.framework === 'ansi',
        reason:
          runtimeConfig.tui.framework === 'ansi'
            ? 'explicit tui.framework=ansi'
            : 'auto: secure masked first-run credential setup',
      }
    : createdRenderer;
  const renderer = selectedRenderer.renderer;
  let state: TuiShellState = createInitialState(ws);
  let pendingUserText = '';
  let pendingPermissionId: string | null = null;
  let agentTurnActive = false;
  let sessionApiKey: string | null = null;
  let setupPersistencePending = false;
  let setupFinishing = false;

  // Detect first-run → enter setup wizard
  if (needsSetup) {
    state = tuiShellReducer(state, { type: 'setup_start' });
    state = { ...state, setupBaseUrl: 'https://api.deepseek.com/v1', setupModel: 'deepseek-chat' };
  }

  // Try to create the agent session (skip if in setup)
  let agentSession: Awaited<
    ReturnType<typeof import('./agent-session.js')['createAgentSession']>
  > | null = null;
  if (!needsSetup) {
    try {
      const { createAgentSession } = await import('./agent-session.js');
      agentSession = await createAgentSession(ws);
      // Show loaded config so user knows what's active
      state = tuiShellReducer(state, {
        type: 'system_message',
        text: `iTestAgent ready.\n${runtimeConfig.model.baseURL ?? 'default endpoint'} / ${runtimeConfig.model.model ?? 'default model'}\nRenderer: ${selectedRenderer.kind} (${selectedRenderer.reason})\nWorkspace: ${ws}\nType a message to get started.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      state = tuiShellReducer(state, {
        type: 'system_message',
        text: `⚠ Agent not available: ${msg}\nType a message to get started.`,
      });
    }
  }

  const finishSetup = async (credentialOutcome: string): Promise<void> => {
    if (setupFinishing) return;
    setupFinishing = true;
    try {
      await saveConfig(state.setupBaseUrl, state.setupModel);
      const currentKey = sessionApiKey;
      const { createAgentSession } = await import('./agent-session.js');
      agentSession = await createAgentSession(ws, {
        loadApiKey: async () => currentKey,
      });
      state = tuiShellReducer(state, { type: 'setup_complete' });
      state = tuiShellReducer(state, {
        type: 'system_message',
        text: `Setup complete. ${credentialOutcome}\nRenderer: ${selectedRenderer.kind} (${selectedRenderer.reason})\n${state.setupBaseUrl} / ${state.setupModel}`,
      });
      sessionApiKey = null;
    } catch (error: unknown) {
      state = tuiShellReducer(state, {
        type: 'system_message',
        text: `Setup could not start the agent: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setupFinishing = false;
      renderer.update(state);
    }
  };

  await renderer.start(state, (event: TuiShellEvent) => {
    // ── Setup mode handling ──────────────────────────────
    if (state.mode === 'setup' && event.type === 'submit') {
      const input = pendingUserText.trim();
      pendingUserText = '';

      switch (state.setupStep) {
        case 0: {
          // Base URL
          const url = input || state.setupBaseUrl;
          const fixed = url.startsWith('http') ? url : `https://${url}`;
          try {
            assertProviderUrl(fixed);
            state = { ...state, setupStep: 1, setupBaseUrl: fixed, setupError: '' };
          } catch (error: unknown) {
            state = {
              ...state,
              setupError: error instanceof Error ? error.message : String(error),
            };
          }
          break;
        }
        case 1: {
          // API Key (input hidden in renderer)
          if (!input || input.length < 10) {
            state = { ...state, setupError: 'API key too short. Paste the full key.' };
          } else {
            sessionApiKey = input;
            state = { ...state, setupStep: 2, setupError: '' };
          }
          break;
        }
        case 2: {
          // Model name
          const model = input || state.setupModel;
          state = { ...state, setupModel: model, setupStep: 3, setupError: '' };
          break;
        }
        case 3: {
          if (input === 'session') {
            void finishSetup('API key is available for this process only.');
          } else if (input === 'save') {
            const notice = formatPersistenceAuthorizationNotice(DEFAULT_API_KEY_TARGET).join('\n');
            state = { ...state, setupStep: 4, setupError: '' };
            state = tuiShellReducer(state, {
              type: 'system_message',
              text: `${notice}\nType "${PERSISTENCE_CONFIRMATION_TOKEN}" again to authorize this one Keychain write, or type "session" to decline.`,
            });
          } else {
            state = { ...state, setupError: 'Type session or save.' };
          }
          break;
        }
        case 4: {
          if (input === 'session') {
            void finishSetup('Keychain save declined; API key is available for this process only.');
            break;
          }
          if (input !== PERSISTENCE_CONFIRMATION_TOKEN || !sessionApiKey) {
            state = { ...state, setupError: 'Type save to confirm or session to decline.' };
            break;
          }
          if (setupPersistencePending) break;
          setupPersistencePending = true;
          const authorization = authorizePersistence(input, DEFAULT_API_KEY_TARGET);
          void (async () => {
            const result = authorization.ok
              ? await saveCredential(
                  createSecurityRunner(),
                  DEFAULT_API_KEY_TARGET,
                  sessionApiKey ?? '',
                  authorization.value,
                )
              : authorization;
            setupPersistencePending = false;
            await finishSetup(
              result.ok
                ? 'API key saved to the verified device-local Keychain item.'
                : `Keychain save was not verified (${result.error.code}); API key is available for this process only.`,
            );
          })();
          break;
        }
      }
      renderer.update(state);
      return;
    }

    // ── Regular chat mode handling ─────────────────────
    if (event.type === 'input') {
      pendingUserText = event.text;
      state = tuiShellReducer(state, event);
      if (state.mode !== 'setup') renderer.update(state);
      return;
    }

    if (event.type === 'candidate_confirm' && agentSession) {
      try {
        for (const patch of agentSession.confirmCandidates(state.candidates)) {
          state = applyAgentPatch(state, patch);
        }
      } catch (error: unknown) {
        state = tuiShellReducer(state, {
          type: 'system_message',
          text: error instanceof Error ? error.message : String(error),
        });
      }
      renderer.update(state);
      return;
    }

    if (event.type === 'plan_modify_submit' && agentSession) {
      state = tuiShellReducer(state, event);
      try {
        for (const patch of agentSession.modifyPlan(state.planModifyDraft)) {
          state = applyAgentPatch(state, patch);
        }
      } catch (error: unknown) {
        state = tuiShellReducer(state, {
          type: 'system_message',
          text: error instanceof Error ? error.message : String(error),
        });
      }
      renderer.update(state);
      return;
    }

    if (event.type === 'plan_confirm' && agentSession) {
      state = tuiShellReducer(state, event);
      try {
        for (const patch of agentSession.confirmPlan()) state = applyAgentPatch(state, patch);
      } catch (error: unknown) {
        state = tuiShellReducer(state, {
          type: 'system_message',
          text: error instanceof Error ? error.message : String(error),
        });
      }
      renderer.update(state);
      return;
    }

    if (event.type === 'plan_cancel' && agentSession) {
      state = tuiShellReducer(state, event);
      for (const patch of agentSession.cancelPlan()) state = applyAgentPatch(state, patch);
      renderer.update(state);
      return;
    }

    if (event.type === 'submit' && pendingPermissionId && agentSession) {
      const decision = pendingUserText.trim().toLowerCase();
      pendingUserText = '';
      state = tuiShellReducer(state, event);

      if (['allow', 'yes', 'y'].includes(decision)) {
        void agentSession.resolvePermission(pendingPermissionId, 'allow', false);
        pendingPermissionId = null;
      } else if (['deny', 'no', 'n', 'always-deny'].includes(decision)) {
        const callId = pendingPermissionId;
        void agentSession
          .resolvePermission(callId, 'deny', decision === 'always-deny')
          .catch((error: unknown) => {
            state = tuiShellReducer(state, {
              type: 'system_message',
              text: `Permission decision was not persisted: ${error instanceof Error ? error.message : String(error)}`,
            });
            renderer.update(state);
          });
        pendingPermissionId = null;
      } else {
        state = tuiShellReducer(state, {
          type: 'system_message',
          text: 'Reply with allow, deny, or always-deny.',
        });
      }
      renderer.update(state);
      return;
    }

    if (event.type === 'submit' && pendingUserText && agentSession && !agentTurnActive) {
      const text = pendingUserText;
      pendingUserText = '';
      state = tuiShellReducer(state, event);
      agentTurnActive = true;
      void processAgentMessage(agentSession, text, (patch) => {
        state = applyAgentPatch(state, patch);
        if (patch.type === 'permission_request') {
          pendingPermissionId =
            typeof patch.payload.callId === 'string' ? patch.payload.callId : null;
        } else if (
          patch.type === 'permission_resolved' &&
          patch.payload.callId === pendingPermissionId
        ) {
          pendingPermissionId = null;
        }
        renderer.update(state);
      }).finally(() => {
        agentTurnActive = false;
        pendingPermissionId = null;
      });
      renderer.update(state);
      return;
    }

    if (event.type === 'submit' && pendingUserText && agentTurnActive) {
      pendingUserText = '';
      state = tuiShellReducer(state, event);
      state = tuiShellReducer(state, {
        type: 'system_message',
        text: 'The current agent turn is still running.',
      });
      renderer.update(state);
      return;
    }

    if (event.type === 'submit') {
      state = tuiShellReducer(state, event);
      if (state.mode !== 'setup') renderer.update(state);
      return;
    }

    state = tuiShellReducer(state, event);
    if (state.mode !== 'setup') renderer.update(state);
  });
}

// ── Agent message processing ────────────────────────────────

async function processAgentMessage(
  session: {
    processMessage(
      input: string,
    ): AsyncIterable<{ type: string; payload: Record<string, unknown> }>;
  },
  text: string,
  onPatch: (patch: { type: string; payload: Record<string, unknown> }) => void,
): Promise<void> {
  try {
    for await (const patch of session.processMessage(text)) {
      onPatch(patch);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    onPatch({ type: 'error', payload: { message: msg } });
  }
}

export function applyAgentPatch(
  state: TuiShellState,
  patch: { type: string; payload: Record<string, unknown> },
): TuiShellState {
  switch (patch.type) {
    case 'planning_reset':
      return tuiShellReducer(state, { type: 'planning_reset' });
    case 'intent_update': {
      if (patch.payload.result === null || patch.payload.result === undefined) return state;
      return tuiShellReducer(state, {
        type: 'intent_parsed',
        result: parseIntentResult(patch.payload.result),
      });
    }
    case 'candidates_update': {
      const candidates = Array.isArray(patch.payload.candidates)
        ? (patch.payload.candidates as CandidateLink[])
        : [];
      return tuiShellReducer(state, { type: 'enter_candidate_review', candidates });
    }
    case 'plan_update': {
      if (patch.payload.plan === null) {
        return tuiShellReducer(state, { type: 'plan_cancel' });
      }
      const plan = parseTestPlan(patch.payload.plan);
      const reviewing = tuiShellReducer(state, { type: 'enter_plan_review', plan });
      return patch.payload.confirmed === true
        ? tuiShellReducer(reviewing, { type: 'plan_confirm' })
        : reviewing;
    }
    case 'mode_change':
      return state;
    case 'message_update': {
      const id = typeof patch.payload.id === 'string' ? patch.payload.id : '';
      const text =
        typeof patch.payload.text === 'string'
          ? patch.payload.text
          : String(patch.payload.text ?? '');
      return tuiShellReducer(state, { type: 'stream_delta', id, text });
    }
    case 'message_add': {
      const text =
        typeof patch.payload.text === 'string'
          ? patch.payload.text
          : String(patch.payload.text ?? '');
      return tuiShellReducer(state, { type: 'system_message', text });
    }
    case 'devices_update': {
      const devices = Array.isArray(patch.payload.devices) ? patch.payload.devices : [];
      const discoveryStatus = patch.payload.discoveryStatus;
      const hasReadyDevice = devices.some((device) => {
        if (!device || typeof device !== 'object') return false;
        const value = device as Record<string, unknown>;
        return value.targetKind === 'physical' || value.state === 'booted';
      });
      const status =
        discoveryStatus === 'failed'
          ? 'unavailable'
          : discoveryStatus === 'partial'
            ? 'degraded'
            : hasReadyDevice
              ? 'healthy'
              : devices.length > 0
                ? 'unavailable'
                : 'no_device';
      return tuiShellReducer(state, {
        type: 'device_status_updated',
        status,
      });
    }
    case 'permission_request': {
      const action = String(patch.payload.action ?? 'unknown action');
      const resource = String(patch.payload.resource ?? 'unknown resource');
      return tuiShellReducer(state, {
        type: 'system_message',
        text: `Permission required: ${action} on ${resource}. Reply allow, deny, or always-deny. Allow applies to this action only.`,
      });
    }
    case 'permission_resolved': {
      return tuiShellReducer(state, {
        type: 'system_message',
        text: `Permission ${String(patch.payload.effect ?? 'resolved')}.`,
      });
    }
    case 'error': {
      const message =
        typeof patch.payload.message === 'string'
          ? patch.payload.message
          : String(patch.payload.message ?? '');
      return tuiShellReducer(state, { type: 'system_message', text: `❌ ${message}` });
    }
    default:
      return state;
  }
}

/** B29: maps a thrown agent-session error to a readable message. */
export function agentSessionErrorMessage(error: unknown): string {
  return `Agent session error: ${error instanceof Error ? error.message : String(error)}`;
}
