import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import type { TuiRenderer } from './renderer.js';
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

function saveConfig(baseUrl: string, model: string): void {
  const dir = resolve(homedir(), '.itestagent', 'config');
  const path = resolve(dir, 'itestagent.jsonc');
  Bun.write(
    path,
    JSON.stringify(
      {
        schemaVersion: '1.0',
        model: { provider: 'openai', baseURL: baseUrl, apiKeyRef: 'openai_api_key', model },
        device: { allowCrossTargetFallback: false },
        tui: { framework: 'opentui' },
      },
      null,
      2,
    ),
  );
}

function loadConfigForDisplay(): { baseURL: string; model: string } {
  const path = resolve(homedir(), '.itestagent', 'config', 'itestagent.jsonc');
  try {
    const raw = readFileSync(path, 'utf-8');
    const cfg = parseJsonc(raw) as Record<string, unknown>;
    const m = cfg.model as Record<string, unknown> | undefined;
    return {
      baseURL: (m?.baseURL as string) ?? 'unknown',
      model: (m?.model as string) ?? 'unknown',
    };
  } catch {
    return { baseURL: 'unknown', model: 'unknown' };
  }
}

function saveApiKey(key: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      '/usr/bin/security',
      [
        'add-generic-password',
        '-s',
        'itestagent/openai_api_key',
        '-a',
        'itestagent',
        '-w',
        key,
        '-U',
      ],
      { stdio: 'ignore' },
    );
    child.on('close', (code) => resolvePromise(code === 0));
    child.on('error', () => resolvePromise(false));
  });
}

// ── TUI entry ───────────────────────────────────────────────

export async function startTui(workspace?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('iTestAgent TUI requires a terminal.');
    console.log("Run 'itestagent --help' for available commands.");
    return;
  }

  const { createAnsiRenderer } = await import('./renderers/ansi-renderer.js');

  const ws = workspace ?? process.cwd();
  let state: TuiShellState = createInitialState(ws);
  let pendingUserText = '';
  let pendingPermissionId: string | null = null;
  let agentTurnActive = false;

  // Detect first-run → enter setup wizard
  const needsSetup = isFirstRun();
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
      const cfg = loadConfigForDisplay();
      state = tuiShellReducer(state, {
        type: 'system_message',
        text: `iTestAgent ready.\n${cfg.baseURL} / ${cfg.model}\nWorkspace: ${ws}\nType a message to get started.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      state = tuiShellReducer(state, {
        type: 'system_message',
        text: `⚠ Agent not available: ${msg}\nType a message to get started.`,
      });
    }
  }

  const renderer: TuiRenderer = createAnsiRenderer();

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
          state = { ...state, setupStep: 1, setupBaseUrl: fixed, setupError: '' };
          break;
        }
        case 1: {
          // API Key (input hidden in renderer)
          if (!input || input.length < 10) {
            state = { ...state, setupError: 'API key too short. Paste the full key.' };
          } else {
            saveApiKey(input).then((ok) => {
              if (!ok) console.error('Warning: failed to save API key to Keychain');
            });
            state = { ...state, setupStep: 2, setupError: '' };
          }
          break;
        }
        case 2: {
          // Model name
          const model = input || state.setupModel;
          saveConfig(state.setupBaseUrl, model);
          state = { ...state, setupModel: model };
          state = tuiShellReducer(state, { type: 'setup_complete' });
          state = tuiShellReducer(state, {
            type: 'system_message',
            text: `Setup complete! ${state.setupBaseUrl} / ${model}\nType a message to get started.`,
          });
          void (async () => {
            try {
              const { createAgentSession } = await import('./agent-session.js');
              agentSession = await createAgentSession(ws);
              renderer.update(state);
            } catch {
              /* noop */
            }
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

    if (event.type === 'submit' && pendingPermissionId && agentSession) {
      const decision = pendingUserText.trim().toLowerCase();
      pendingUserText = '';
      state = tuiShellReducer(state, event);

      if (['allow', 'yes', 'y', 'session'].includes(decision)) {
        agentSession.resolvePermission(pendingPermissionId, 'allow', decision === 'session');
        pendingPermissionId = null;
      } else if (['deny', 'no', 'n'].includes(decision)) {
        agentSession.resolvePermission(pendingPermissionId, 'deny');
        pendingPermissionId = null;
      } else {
        state = tuiShellReducer(state, {
          type: 'system_message',
          text: 'Reply with allow, session, or deny.',
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
        text: `Permission required: ${action} on ${resource}. Reply allow, session, or deny.`,
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
