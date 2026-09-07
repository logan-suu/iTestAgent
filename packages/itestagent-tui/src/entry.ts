import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  DeviceInfoSchema,
  TargetKindSchema,
  parseIntentResult,
  parseTestPlan,
} from 'itestagent-contracts';
import { assertProviderUrl } from 'itestagent-engine';
import type { CandidateLink } from 'itestagent-project-analyzer';
import { DEFAULT_API_KEY_TARGET, loadApiKey as loadStoredApiKey } from './api-key-loader.js';
import { formatPersistenceAuthorizationNotice } from './credential-prompt.js';
import { devicesForTarget, isDeviceReady } from './device-review.js';
import {
  PERSISTENCE_CONFIRMATION_TOKEN,
  authorizePersistence,
  createSecurityRunner,
  saveCredential,
} from './keychain-persistence.js';
import {
  DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_MODEL,
  resolveProviderValidationTransition,
  validateProviderAccess,
} from './provider-validation.js';
import { createConfiguredRenderer } from './renderer-factory.js';
import type { RendererKind } from './renderer-selection.js';
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

export function requiresProviderSetup(
  configMissing: boolean,
  storedCredentialAvailable: boolean,
): boolean {
  return configMissing || !storedCredentialAvailable;
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

export function assertSecureFirstRunRenderer(kind: RendererKind): void {
  if (kind === 'ink') {
    throw new Error(
      'renderer_unavailable: ink: secure masked first-run setup is not implemented; use tui.framework=opentui or ansi',
    );
  }
}

export interface LatestOperationGate {
  begin(): number;
  isCurrent(token: number): boolean;
  invalidate(): void;
}

/** Prevents late async UI operations from committing state after a newer user action. */
export function createLatestOperationGate(): LatestOperationGate {
  let revision = 0;
  return {
    begin() {
      revision += 1;
      return revision;
    },
    isCurrent(token) {
      return token === revision;
    },
    invalidate() {
      revision += 1;
    },
  };
}

// ── TUI entry ───────────────────────────────────────────────

export async function startTui(workspace?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('iTestAgent TUI requires a terminal.');
    console.log("Run 'itestagent --help' for available commands.");
    return;
  }

  const ws = workspace ?? process.cwd();
  const configMissing = isFirstRun();
  const runtimeConfig = loadTuiRuntimeConfig({ workspace: ws });
  const storedCredential = configMissing ? null : await loadStoredApiKey();
  const needsSetup = requiresProviderSetup(configMissing, storedCredential?.ok === true);
  const selectedRenderer = await createConfiguredRenderer(runtimeConfig.tui.framework);
  if (needsSetup) assertSecureFirstRunRenderer(selectedRenderer.kind);
  const renderer = selectedRenderer.renderer;
  let state: TuiShellState = createInitialState(ws);
  let pendingUserText = '';
  let pendingPermissionId: string | null = null;
  let agentTurnActive = false;
  let deviceSelectionPending = false;
  const deviceOperationGate = createLatestOperationGate();
  let sessionApiKey: string | null = null;
  let setupPersistencePending = false;
  let setupFinishing = false;
  let setupValidationPending = false;
  let providerValidated = false;

  // Detect first-run → enter setup wizard
  if (needsSetup) {
    state = tuiShellReducer(state, { type: 'setup_start' });
    state = {
      ...state,
      setupBaseUrl: runtimeConfig.model.baseURL ?? DEFAULT_PROVIDER_BASE_URL,
      setupModel: runtimeConfig.model.model ?? DEFAULT_PROVIDER_MODEL,
      setupError:
        !configMissing && storedCredential && !storedCredential.ok
          ? 'No usable Keychain API key was found. Enter a provider credential for this session.'
          : '',
    };
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
    if (!providerValidated) {
      state = {
        ...state,
        setupError: 'Provider validation is required before setup can complete.',
      };
      renderer.update(state);
      return;
    }
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
      if (setupValidationPending) {
        state = { ...state, setupError: 'Provider validation is still running.' };
        renderer.update(state);
        return;
      }
      const input = pendingUserText.trim();
      pendingUserText = '';

      switch (state.setupStep) {
        case 0: {
          // Base URL
          const url = input || state.setupBaseUrl;
          const fixed = url.startsWith('http') ? url : `https://${url}`;
          try {
            assertProviderUrl(fixed);
            providerValidated = false;
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
            providerValidated = false;
            state = { ...state, setupStep: 2, setupError: '' };
          }
          break;
        }
        case 2: {
          // Model name
          const model = input || state.setupModel;
          const currentKey = sessionApiKey;
          if (!currentKey) {
            state = {
              ...state,
              setupStep: 1,
              setupError: 'API key is required before provider validation.',
            };
            break;
          }
          setupValidationPending = true;
          providerValidated = false;
          state = {
            ...state,
            setupModel: model,
            setupError: 'Validating provider endpoint, API key, and model…',
          };
          void (async () => {
            const result = await validateProviderAccess({
              baseURL: state.setupBaseUrl,
              model,
              apiKey: currentKey,
            });
            setupValidationPending = false;
            const transition = resolveProviderValidationTransition(result);
            providerValidated = transition.providerValidated;
            if (transition.clearSessionApiKey) sessionApiKey = null;
            state = {
              ...state,
              setupStep: transition.setupStep,
              setupError: transition.error,
            };
            renderer.update(state);
          })();
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

    if (event.type === 'device_confirm' && agentSession) {
      if (deviceSelectionPending) return;
      const targetKind = state.deviceSelectionTargetKind;
      const candidates = targetKind ? devicesForTarget(state.devices, targetKind) : [];
      const selected = candidates[state.deviceSelectionIndex];
      if (!selected) {
        state = tuiShellReducer(state, {
          type: 'system_message',
          text: 'No matching device is available. Connect or boot one, then press r to refresh.',
        });
      } else {
        const operationToken = deviceOperationGate.begin();
        deviceSelectionPending = true;
        state = tuiShellReducer(state, { type: 'device_status_updated', status: 'checking' });
        void agentSession
          .selectDevice(selected.udid)
          .then((patches) => {
            if (!deviceOperationGate.isCurrent(operationToken)) return;
            for (const patch of patches) state = applyAgentPatch(state, patch);
          })
          .catch((error: unknown) => {
            if (!deviceOperationGate.isCurrent(operationToken)) return;
            state = tuiShellReducer(state, {
              type: 'system_message',
              text: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            if (!deviceOperationGate.isCurrent(operationToken)) return;
            deviceSelectionPending = false;
            renderer.update(state);
          });
      }
      renderer.update(state);
      return;
    }

    if (event.type === 'device_refresh' && agentSession) {
      const operationToken = deviceOperationGate.begin();
      deviceSelectionPending = false;
      state = tuiShellReducer(state, { type: 'device_status_updated', status: 'checking' });
      renderer.update(state);
      void agentSession
        .refreshDevices()
        .then((patches) => {
          if (!deviceOperationGate.isCurrent(operationToken)) return;
          for (const patch of patches) state = applyAgentPatch(state, patch);
          renderer.update(state);
        })
        .catch((error: unknown) => {
          if (!deviceOperationGate.isCurrent(operationToken)) return;
          state = tuiShellReducer(state, {
            type: 'system_message',
            text: error instanceof Error ? error.message : String(error),
          });
          renderer.update(state);
        });
      return;
    }

    if (event.type === 'device_cancel' && agentSession) {
      deviceOperationGate.invalidate();
      deviceSelectionPending = false;
      state = tuiShellReducer(state, event);
      for (const patch of agentSession.cancelPlan()) state = applyAgentPatch(state, patch);
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
      deviceOperationGate.invalidate();
      deviceSelectionPending = false;
      let confirmed = false;
      try {
        for (const patch of agentSession.confirmPlan()) state = applyAgentPatch(state, patch);
        confirmed = true;
      } catch (error: unknown) {
        state = tuiShellReducer(state, {
          type: 'system_message',
          text: error instanceof Error ? error.message : String(error),
        });
      }
      renderer.update(state);
      if (confirmed) {
        agentTurnActive = true;
        void processConfirmedPlan(agentSession, (patch) => {
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
      }
      return;
    }

    if (event.type === 'plan_cancel' && agentSession) {
      deviceOperationGate.invalidate();
      deviceSelectionPending = false;
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

export async function processConfirmedPlan(
  session: {
    executeConfirmedPlan(): AsyncIterable<{
      type: string;
      payload: Record<string, unknown>;
    }>;
  },
  onPatch: (patch: { type: string; payload: Record<string, unknown> }) => void,
): Promise<void> {
  const bootstrapActivityId = `confirmed-plan-${crypto.randomUUID()}`;
  onPatch({
    type: 'activity_update',
    payload: {
      id: bootstrapActivityId,
      text: 'Preparing confirmed TestPlan execution…',
    },
  });
  try {
    let receivedTerminalPatch = false;
    for await (const patch of session.executeConfirmedPlan()) {
      if (
        patch.type === 'error' ||
        (patch.type === 'activity_update' && patch.payload.complete === true)
      ) {
        receivedTerminalPatch = true;
      }
      onPatch(patch);
    }
    if (!receivedTerminalPatch) {
      onPatch({
        type: 'error',
        payload: { message: 'Confirmed TestPlan execution ended without a lifecycle result.' },
      });
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
    case 'device_selection_request': {
      const devices = DeviceInfoSchema.array().parse(patch.payload.devices ?? []);
      const targetKind = TargetKindSchema.parse(patch.payload.targetKind);
      const withDevices = tuiShellReducer(state, {
        type: 'devices_updated',
        devices,
        status: devices.length > 0 ? 'discovered' : 'no_device',
      });
      return tuiShellReducer(withDevices, {
        type: 'enter_device_review',
        targetKind,
        devices,
      });
    }
    case 'device_selected':
      return tuiShellReducer(state, {
        type: 'device_selected',
        udid: String(patch.payload.udid ?? ''),
      });
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
    case 'activity_update': {
      const callId = typeof patch.payload.id === 'string' ? patch.payload.id : '';
      if (!callId) return state;
      if (patch.payload.complete === true) {
        return tuiShellReducer(state, { type: 'agent_activity_cleared', callId });
      }
      const text = typeof patch.payload.text === 'string' ? patch.payload.text : 'Working…';
      return tuiShellReducer(state, { type: 'agent_activity_updated', callId, text });
    }
    case 'devices_update': {
      const devices = DeviceInfoSchema.array().parse(patch.payload.devices ?? []);
      const discoveryStatus = patch.payload.discoveryStatus;
      const parsedTargetKind = TargetKindSchema.safeParse(patch.payload.targetKind);
      const targetKind = parsedTargetKind.success
        ? parsedTargetKind.data
        : (state.deviceSelectionTargetKind ?? state.plan?.device.kind ?? null);
      const relevantDevices = targetKind
        ? devices.filter((device) => device.targetKind === targetKind)
        : devices;
      const status =
        discoveryStatus === 'failed'
          ? 'unavailable'
          : discoveryStatus === 'partial'
            ? 'degraded'
            : relevantDevices.length === 0
              ? 'no_device'
              : relevantDevices.some(isDeviceReady)
                ? 'discovered'
                : 'unavailable';
      return tuiShellReducer(state, {
        type: 'devices_updated',
        devices,
        status,
      });
    }
    case 'permission_request': {
      const callId = String(patch.payload.callId ?? 'permission');
      const action = String(patch.payload.action ?? 'unknown action');
      const resource = formatPermissionResourceForDisplay(
        action,
        String(patch.payload.resource ?? 'unknown resource'),
      );
      const timeoutMs = patch.payload.timeoutMs;
      const deadline =
        typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
          ? ` Respond within ${Math.ceil(timeoutMs / 1000)}s or execution will stop.`
          : '';
      const explanation =
        action === 'prepare_wda'
          ? ' Prepare WebDriverAgent (WDA) to automate the selected device.'
          : '';
      const waiting = tuiShellReducer(state, {
        type: 'agent_activity_updated',
        callId,
        text: `Awaiting permission: ${action} — type allow + Enter to continue`,
      });
      return tuiShellReducer(waiting, {
        type: 'system_message',
        text: `Permission required: ${action} on ${resource}.${explanation} Execution is paused. Type allow, deny, or always-deny and press Enter.${deadline} Allow applies to this action only.`,
      });
    }
    case 'permission_resolved': {
      const callId = String(patch.payload.callId ?? 'permission');
      const effect = String(patch.payload.effect ?? 'resolved');
      const reason = patch.payload.reason;
      if (reason === 'timeout' || reason === 'cancelled' || reason === 'error') {
        const cleared = tuiShellReducer(state, { type: 'agent_activity_cleared', callId });
        const message =
          reason === 'timeout'
            ? 'Permission wait timed out without a response; execution stopped. This was not a user denial.'
            : reason === 'cancelled'
              ? 'Permission request cancelled; execution stopped.'
              : 'Permission request failed; execution stopped.';
        return tuiShellReducer(cleared, { type: 'system_message', text: message });
      }
      const continuing = tuiShellReducer(state, {
        type: 'agent_activity_updated',
        callId,
        text:
          effect === 'allow'
            ? 'Permission granted; preparing execution…'
            : 'Permission denied; stopping…',
      });
      return tuiShellReducer(continuing, {
        type: 'system_message',
        text: `Permission ${effect}.`,
      });
    }
    case 'error': {
      const message =
        typeof patch.payload.message === 'string'
          ? patch.payload.message
          : String(patch.payload.message ?? '');
      const cleared = state.agentActivity
        ? tuiShellReducer(state, {
            type: 'agent_activity_cleared',
            callId: state.agentActivity.callId,
          })
        : state;
      return tuiShellReducer(cleared, { type: 'system_message', text: `❌ ${message}` });
    }
    default:
      return state;
  }
}

function formatPermissionResourceForDisplay(action: string, resource: string): string {
  if (
    action !== 'replace_device_app' &&
    action !== 'prepare_wda' &&
    action !== 'execute_project_build'
  ) {
    return resource;
  }
  const deviceSeparator = resource.lastIndexOf('@');
  return deviceSeparator > 0 ? `${resource.slice(0, deviceSeparator)}@selected device` : resource;
}

/** B29: maps a thrown agent-session error to a readable message. */
export function agentSessionErrorMessage(error: unknown): string {
  return `Agent session error: ${error instanceof Error ? error.message : String(error)}`;
}
