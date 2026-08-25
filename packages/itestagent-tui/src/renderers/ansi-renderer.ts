import type { createInterface } from 'node:readline';
import type { TuiRenderer } from '../renderer.js';
import type { TuiShellEvent, TuiShellState } from '../tui-shell.js';
import { createInitialState, tuiShellReducer } from '../tui-shell.js';

// ── Simple ANSI terminal renderer — zero external dependencies ──

const CSI = '\x1b[';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

function clearScreen() {
  process.stdout.write(`${CSI}2J${CSI}H`);
}

function moveTo(row: number, col: number) {
  process.stdout.write(`${CSI}${row};${col}H`);
}

type Mode =
  | 'chat'
  | 'setup'
  | 'candidate_review'
  | 'plan_review'
  | 'recording_review'
  | 'credential_prompt';

function render(state: TuiShellState): string[] {
  const lines: string[] = [];
  const cols = process.stdout.columns || 80;
  const mode = state.mode as Mode;

  // Header
  lines.push(`${BOLD}iTestAgent v0.0.1${RESET}`);
  lines.push(`${DIM}${state.workspace}${RESET}`);
  lines.push('─'.repeat(Math.min(cols, 80)));

  // Messages
  for (const msg of state.messages) {
    const prefix =
      msg.type === 'user'
        ? `${GREEN}YOU${RESET}`
        : msg.type === 'assistant'
          ? `${CYAN} AI${RESET}`
          : msg.type === 'error'
            ? `${RED}ERR${RESET}`
            : `${DIM}SYS${RESET}`;
    lines.push(`[${prefix}] ${msg.text}`);
  }

  if (state.messages.length === 0) {
    lines.push(`${DIM}Type a message and press Enter.${RESET}`);
  }

  lines.push('');
  lines.push('─'.repeat(Math.min(cols, 80)));

  // Mode indicator
  if (mode === 'setup') {
    lines.push('');
    lines.push(`${BOLD}${CYAN}First-Time Setup${RESET}`);
    lines.push(`${DIM}Configure your AI provider to get started.${RESET}`);
    lines.push('');

    const step = state.setupStep;
    if (step === 0) {
      lines.push(`${BOLD}API Base URL${RESET}`);
      lines.push(`${DIM}Default: ${state.setupBaseUrl}${RESET}`);
      lines.push('Press Enter to accept default, or type a custom URL.');
      if (state.setupError) lines.push(`${RED}${state.setupError}${RESET}`);
    } else if (step === 1) {
      lines.push(`${BOLD}API Key${RESET}`);
      lines.push(`${DIM}Paste your API key (input is hidden):${RESET}`);
      if (state.setupError) lines.push(`${RED}${state.setupError}${RESET}`);
    } else if (step === 2) {
      lines.push(`${BOLD}Model Name${RESET}`);
      lines.push(`${DIM}Default: ${state.setupModel}${RESET}`);
      lines.push('Press Enter to accept default, or type a custom model name.');
      if (state.setupError) lines.push(`${RED}${state.setupError}${RESET}`);
    }
    lines.push('');
    lines.push(`${DIM}Ctrl+C to exit setup at any time.${RESET}`);
  } else if (mode === 'candidate_review') {
    lines.push(
      `${YELLOW}[Candidate Review]${RESET} j/k to navigate, Space to toggle, Enter to confirm`,
    );
  } else if (mode === 'plan_review') {
    lines.push(`${YELLOW}[Plan Review]${RESET} j/k to navigate, Enter to confirm, q to cancel`);
  }

  return lines;
}

function renderScreen(state: TuiShellState) {
  clearScreen();
  const lines = render(state);
  for (let i = 0; i < lines.length; i++) {
    process.stdout.write(`${lines[i]}\r\n`);
  }
  // Input prompt
  process.stdout.write(state.mode === 'setup' ? '' : '> ');
}

export function createAnsiRenderer(): TuiRenderer {
  let currentState: TuiShellState;
  let dispatchFn: ((event: TuiShellEvent) => void) | null = null;
  const rl: ReturnType<typeof createInterface> | null = null;
  let inputBuffer = '';

  return {
    async start(initialState, dispatch) {
      currentState = initialState;
      dispatchFn = dispatch;

      // Render initial screen
      renderScreen(currentState);

      // Set up raw stdin
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf-8');

      const onData = (chunk: string) => {
        for (const char of chunk) {
          const code = char.charCodeAt(0);

          // Ctrl+C → exit
          if (code === 3) {
            process.stdout.write(`${RESET}\r\n`);
            process.stdin.setRawMode?.(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.exit(0);
            return;
          }

          // Backspace / Delete
          if (code === 127 || code === 8) {
            if (inputBuffer.length > 0) {
              inputBuffer = inputBuffer.slice(0, -1);
              // Clear input line and re-render
              moveToCursor();
              process.stdout.write('\x1b[0K');
              process.stdout.write(`> ${inputBuffer}`);
            }
            continue;
          }

          // Enter
          if (code === 13) {
            const text = inputBuffer.trim();
            inputBuffer = '';
            if (dispatchFn) {
              dispatchFn({ type: 'input', text });
              dispatchFn({ type: 'submit' });
              // Re-render
              renderScreen(currentState);
            }
            continue;
          }

          // Printable characters
          if (code >= 32 && code < 127) {
            inputBuffer += char;
            process.stdout.write(char);
          }
        }
      };

      process.stdin.on('data', onData);

      // Wait for exit signal
      await new Promise<void>((resolve) => {
        process.once('SIGINT', () => {
          process.stdout.write(`${RESET}\r\n`);
          process.stdin.setRawMode?.(false);
          resolve();
        });
      });
    },

    update(state: TuiShellState) {
      currentState = state;
      renderScreen(state);
      process.stdout.write(`> ${inputBuffer}`);
    },
  };
}

function moveToCursor() {
  // Move to the prompt line position
  process.stdout.write('\x1b[G');
}
