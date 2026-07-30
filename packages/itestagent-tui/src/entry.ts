import type { TuiRenderer } from './renderer.js';
import {
  createInitialState,
  tuiShellReducer,
  type TuiShellEvent,
  type TuiShellState,
} from './tui-shell.js';

export async function startTui(workspace?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('iTestAgent TUI requires a terminal.');
    console.log("Run 'itestagent --help' for available commands.");
    return;
  }

  // Lazy-load renderer to avoid dependency issues for CLI commands
  const { createAnsiRenderer } = await import('./renderers/ansi-renderer.js');

  const ws = workspace ?? process.cwd();
  let state: TuiShellState = createInitialState(ws);
  let pendingUserText = '';

  // Try to create the agent session (may fail gracefully)
  let agentSession: Awaited<ReturnType<(typeof import('./agent-session.js'))['createAgentSession']>> | null = null;
  try {
    const { createAgentSession } = await import('./agent-session.js');
    agentSession = await createAgentSession(ws);
    state = tuiShellReducer(state, {
      type: 'system_message',
      text: `iTestAgent ready. Workspace: ${ws}\nType /help for commands, or describe what you want to test.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    state = tuiShellReducer(state, {
      type: 'system_message',
      text: `⚠ Agent not available: ${msg}\nCLI commands (doctor, devices, config) still work.\nType a message to get started.`,
    });
  }

  const renderer: TuiRenderer = createAnsiRenderer();

  await renderer.start(state, (event: TuiShellEvent) => {
    if (event.type === 'input') {
      pendingUserText = event.text;
      state = tuiShellReducer(state, event);
      renderer.update(state);
      return;
    }

    if (event.type === 'submit' && pendingUserText && agentSession) {
      const text = pendingUserText;
      pendingUserText = '';
      state = tuiShellReducer(state, event);

      // Process through agent asynchronously
      processAgentMessage(agentSession, text).then((newState) => {
        state = newState;
        renderer.update(state);
      });
      renderer.update(state);
      return;
    }

    if (event.type === 'submit') {
      state = tuiShellReducer(state, event);
      renderer.update(state);
      return;
    }

    state = tuiShellReducer(state, event);
    renderer.update(state);
  });
}

async function processAgentMessage(
  session: { processMessage(input: string): AsyncIterable<{ type: string; payload: Record<string, unknown> }> },
  text: string,
): Promise<TuiShellState> {
  let state = createInitialState(process.cwd());
  try {
    for await (const patch of session.processMessage(text)) {
      switch (patch.type) {
        case 'message_update': {
          const id = typeof patch.payload.id === 'string' ? patch.payload.id : '';
          const msg = typeof patch.payload.text === 'string' ? patch.payload.text : String(patch.payload.text ?? '');
          state = tuiShellReducer(state, { type: 'stream_delta', id, text: msg });
          break;
        }
        case 'message_add': {
          const msg = typeof patch.payload.text === 'string' ? patch.payload.text : String(patch.payload.text ?? '');
          state = tuiShellReducer(state, { type: 'system_message', text: msg });
          break;
        }
        case 'error': {
          const msg = typeof patch.payload.message === 'string' ? patch.payload.message : String(patch.payload.message ?? '');
          state = tuiShellReducer(state, { type: 'system_message', text: `❌ ${msg}` });
          break;
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    state = tuiShellReducer(state, { type: 'system_message', text: `❌ ${msg}` });
  }
  return state;
}
