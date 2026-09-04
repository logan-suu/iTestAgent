/**
 * ANSI frame composition and screen writing.
 *
 * B27: extracted from src/renderers/ansi-renderer.ts. `renderFrame` builds
 * the logical frame (array of lines, no prompt); `renderScreen` writes a full
 * screen (clear + CRLF-terminated lines + mode-dependent prompt) to a write
 * target that defaults to process.stdout.
 *
 * Byte-level behavior is locked by test/ansi-renderer.test.ts and
 * test/fixtures/ansi-renderer-characterization.ts — do not change output.
 */

import {
  BOLD,
  CHAT_PROMPT,
  CSI,
  CYAN,
  DIM,
  GREEN,
  RED,
  RESET,
  YELLOW,
  separatorLine,
} from '../ansi-layout.js';
import type { TuiShellState } from '../tui-shell.js';

/** Minimal write surface — satisfied by process.stdout and test fakes. */
export interface FrameWriteTarget {
  write(chunk: string): unknown;
}

/** Erase the entire screen and home the cursor. */
export function clearScreen(out: FrameWriteTarget = process.stdout) {
  out.write(`${CSI}2J${CSI}H`);
}

/** Absolute cursor positioning. */
export function moveTo(row: number, col: number, out: FrameWriteTarget = process.stdout) {
  out.write(`${CSI}${row};${col}H`);
}

/**
 * Build the frame lines for the given state. Pure with respect to state;
 * reads the live terminal width for separators (same as the pre-refactor
 * renderer).
 */
export function renderFrame(state: TuiShellState): string[] {
  const lines: string[] = [];
  const cols = process.stdout.columns || 80;
  const mode = state.mode;

  // Header
  lines.push(`${BOLD}iTestAgent v0.0.1${RESET}`);
  lines.push(`${DIM}${state.workspace}${RESET}`);
  lines.push(separatorLine(cols));

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
  lines.push(separatorLine(cols));

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
    } else if (step === 3) {
      lines.push(`${BOLD}Credential Storage${RESET}`);
      lines.push('Type "session" to keep the API key in memory for this process.');
      lines.push('Type "save" to review a separate device-local Keychain confirmation.');
      if (state.setupError) lines.push(`${RED}${state.setupError}${RESET}`);
    } else if (step === 4) {
      lines.push(`${BOLD}Keychain Confirmation${RESET}`);
      lines.push('Review the disclosure above, then type "save" to authorize one write.');
      lines.push('Type "session" to decline persistence.');
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

/**
 * Write a full screen: clear + every frame line CRLF-terminated + prompt.
 * The prompt is empty for setup mode (the wizard hides the chat prompt).
 */
export function renderScreen(state: TuiShellState, out: FrameWriteTarget = process.stdout) {
  clearScreen(out);
  const lines = renderFrame(state);
  for (let i = 0; i < lines.length; i++) {
    out.write(`${lines[i]}\r\n`);
  }
  out.write(state.mode === 'setup' ? '' : CHAT_PROMPT);
}

/** Repaint helper used after backspace: park the cursor at column 1. */
export function moveCursorToPromptColumn(out: FrameWriteTarget = process.stdout) {
  out.write('\x1b[G');
}
