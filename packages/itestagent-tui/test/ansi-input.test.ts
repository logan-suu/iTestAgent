/**
 * Tests for src/ansi-input.ts — ANSI renderer raw-input handling.
 *
 * B27 extracts the stdin `onData` chunk processor out of
 * src/renderers/ansi-renderer.ts into a standalone, hook-based handler so it
 * can be unit-tested without a real TTY. The handler owns the input buffer
 * and emits side effects exclusively through its hooks:
 *
 *   - write(chunk): every byte the old code wrote to process.stdout
 *   - submit(text): Enter key — receives the TRIMMED buffer (may be empty)
 *   - interrupt():  Ctrl+C — called AFTER the reset+newline was written
 *
 * The exact write sequences below mirror the pre-refactor renderer:
 *   - printable char  → echo the char itself
 *   - backspace       → '\x1b[G' then '\x1b[0K' then `> ${buffer}`
 *   - Ctrl+C          → `${RESET}\r\n` then interrupt()
 */

import { describe, expect, it } from 'bun:test';
import { createAnsiInputHandler } from '../src/ansi-input.js';
import { RESET } from '../src/ansi-layout.js';

interface Harness {
  chunks: string[];
  submitted: string[];
  interrupted: number;
  handleChunk: (chunk: string) => void;
  buffer: () => string;
}

function makeHarness(): Harness {
  const h: Harness = {
    chunks: [],
    submitted: [],
    interrupted: 0,
    handleChunk: () => {},
    buffer: () => '',
  };
  const handler = createAnsiInputHandler({
    write: (chunk) => {
      h.chunks.push(chunk);
    },
    submit: (text) => {
      h.submitted.push(text);
    },
    interrupt: () => {
      h.interrupted += 1;
    },
  });
  h.handleChunk = handler.handleChunk;
  h.buffer = handler.getInputBuffer;
  return h;
}

describe('printable character handling', () => {
  it('appends printable characters to the buffer and echoes each one', () => {
    const h = makeHarness();
    h.handleChunk('hi');
    expect(h.buffer()).toBe('hi');
    expect(h.chunks).toEqual(['h', 'i']);
  });

  it('processes a mixed chunk strictly left to right', () => {
    const h = makeHarness();
    h.handleChunk('a\nb');
    // 'a' echoed, '\n' (code 10) ignored, 'b' echoed.
    expect(h.chunks).toEqual(['a', 'b']);
    expect(h.buffer()).toBe('ab');
  });

  it('accepts every ASCII printable from space (32) through tilde (126)', () => {
    const h = makeHarness();
    const allPrintable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    h.handleChunk(allPrintable);
    expect(h.buffer()).toBe(allPrintable);
  });

  it('ignores control characters other than Enter/Ctrl+C/Backspace', () => {
    const h = makeHarness();
    h.handleChunk('\x01\x02\x1b');
    expect(h.buffer()).toBe('');
    expect(h.chunks).toEqual([]);
    expect(h.submitted).toEqual([]);
  });

  it('ignores multi-byte characters whose first code unit is outside ASCII', () => {
    const h = makeHarness();
    h.handleChunk('é中😀');
    expect(h.buffer()).toBe('');
    expect(h.chunks).toEqual([]);
  });
});

describe('backspace handling', () => {
  it('removes the last character and repaints the prompt line', () => {
    const h = makeHarness();
    h.handleChunk('ab');
    h.chunks.length = 0;
    h.handleChunk('\x7f');
    expect(h.buffer()).toBe('a');
    expect(h.chunks).toEqual(['\x1b[G', '\x1b[0K', '> a']);
  });

  it('treats ASCII BS (code 8) exactly like DEL (code 127)', () => {
    const h = makeHarness();
    h.handleChunk('xy');
    h.handleChunk('\x08');
    expect(h.buffer()).toBe('x');
    expect(h.chunks.slice(-3)).toEqual(['\x1b[G', '\x1b[0K', '> x']);
  });

  it('is a silent no-op when the buffer is already empty', () => {
    const h = makeHarness();
    h.handleChunk('\x7f\x7f\x08');
    expect(h.buffer()).toBe('');
    expect(h.chunks).toEqual([]);
  });
});

describe('Enter handling', () => {
  it('submits the trimmed buffer and clears it', () => {
    const h = makeHarness();
    h.handleChunk('  run smoke test ');
    h.handleChunk('\r');
    expect(h.submitted).toEqual(['run smoke test']);
    expect(h.buffer()).toBe('');
  });

  it('still submits (empty string) when Enter is pressed on an empty buffer', () => {
    const h = makeHarness();
    h.handleChunk('\r');
    expect(h.submitted).toEqual(['']);
  });

  it('writes nothing itself — rendering is the submit hook’s job', () => {
    const h = makeHarness();
    h.handleChunk('ok');
    h.chunks.length = 0;
    h.handleChunk('\r');
    expect(h.chunks).toEqual([]);
  });
});

describe('Ctrl+C handling', () => {
  it('writes RESET + CRLF first, then triggers the interrupt hook exactly once', () => {
    const h = makeHarness();
    h.handleChunk('abc');
    h.handleChunk('\x03');
    expect(h.chunks).toContain(`${RESET}\r\n`);
    expect(h.interrupted).toBe(1);
  });

  it('does not modify the buffer or submit on Ctrl+C', () => {
    const h = makeHarness();
    h.handleChunk('abc');
    h.handleChunk('\x03');
    expect(h.submitted).toEqual([]);
    expect(h.buffer()).toBe('abc');
  });
});
