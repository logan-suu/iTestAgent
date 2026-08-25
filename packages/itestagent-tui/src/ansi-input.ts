/**
 * ANSI renderer raw-input handling.
 *
 * B27: extracted from src/renderers/ansi-renderer.ts. The handler owns the
 * input buffer and processes raw stdin chunks exactly as the pre-refactor
 * renderer did, emitting all side effects through hooks so it is testable
 * without a TTY:
 *
 *   - Ctrl+C (code 3):    write `${RESET}\r\n`, then interrupt()
 *   - Backspace (127/8):  if buffer non-empty: drop last char, write
 *                         '\x1b[G', '\x1b[0K', `> ${buffer}`
 *   - Enter (13):         submit(trimmed buffer) — always, even when empty —
 *                         and clear the buffer
 *   - printable (32-126): append to buffer and echo the character
 *   - anything else:      ignored silently (including surrogate code units)
 */

import { RESET } from './ansi-layout.js';

/** Side-effect ports for the input handler. */
export interface AnsiInputHooks {
  /** Receives every chunk the legacy renderer wrote to process.stdout. */
  write(chunk: string): void;
  /**
   * Called on Enter with the TRIMMED input buffer (possibly empty).
   * Dispatch and re-render remain the caller's responsibility.
   */
  submit(text: string): void;
  /** Called after the Ctrl+C reset+newline was written; restores the TTY. */
  interrupt(): void;
}

export interface AnsiInputHandler {
  /** Process one raw stdin chunk (character by character, legacy semantics). */
  handleChunk(chunk: string): void;
  /** Current unsubmitted input buffer. */
  getInputBuffer(): string;
}

const BACKSPACE = [8, 127];
const ENTER = 13;
const CTRL_C = 3;

export function createAnsiInputHandler(hooks: AnsiInputHooks): AnsiInputHandler {
  let inputBuffer = '';

  const handleChunk = (chunk: string) => {
    for (const char of chunk) {
      const code = char.charCodeAt(0);

      // Ctrl+C → exit
      if (code === CTRL_C) {
        hooks.write(`${RESET}\r\n`);
        hooks.interrupt();
        return;
      }

      // Backspace / Delete
      if (BACKSPACE.includes(code)) {
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          hooks.write('\x1b[G');
          hooks.write('\x1b[0K');
          hooks.write(`> ${inputBuffer}`);
        }
        continue;
      }

      // Enter
      if (code === ENTER) {
        const text = inputBuffer.trim();
        inputBuffer = '';
        hooks.submit(text);
        continue;
      }

      // Printable characters
      if (code >= 32 && code < 127) {
        inputBuffer += char;
        hooks.write(char);
      }
    }
  };

  return {
    handleChunk,
    getInputBuffer: () => inputBuffer,
  };
}
