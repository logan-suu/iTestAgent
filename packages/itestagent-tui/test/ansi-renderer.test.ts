/**
 * Characterization tests for the ANSI terminal renderer.
 *
 * ansi-renderer.ts exports a single function, `createAnsiRenderer()`, which
 * returns a TuiRenderer whose `update(state)` re-renders the full screen by
 * writing ANSI escape sequences to `process.stdout`. The internal `render()`
 * helper is private, so these tests observe the renderer through its public
 * `update()` surface and capture every `process.stdout.write` call.
 *
 * NOTE: This is a characterization suite — it locks in the CURRENT behavior
 * of ansi-renderer.ts (including quirks such as the double prompt written by
 * `update()`) so that later refactors have a regression net. It intentionally
 * does NOT call `start()`, which blocks waiting on SIGINT/stdin.
 *
 * All expected bytes live in ./fixtures/ansi-renderer-characterization.ts.
 */

import { describe, expect, it } from 'bun:test';
import {
  CHAT_PROMPT,
  effectiveColumns,
  separatorLine as layoutSeparatorLine,
} from '../src/ansi-layout.js';
import {
  type FrameWriteTarget,
  clearScreen,
  renderFrame,
  renderScreen,
} from '../src/renderers/ansi-renderer-frame.js';
import { createAnsiRenderer } from '../src/renderers/ansi-renderer.js';
import { type Message, type TuiShellState, createInitialState } from '../src/tui-shell.js';
import {
  CLEAR_SCREEN,
  DOUBLE_PROMPT,
  EMPTY_STATE_HINT,
  HEADER_TITLE,
  MAX_SEPARATOR_WIDTH,
  MODE_HINT_LINES,
  SEPARATOR_CHAR,
  SETUP_PANEL,
  buildEmptyChatFrame,
  emptyMessageLineTail,
  headerWorkspaceLine,
  messageLine,
  separatorLine,
} from './fixtures/ansi-renderer-characterization.js';

/** Same separator computation as the renderer: `'─'.repeat(min(cols||80, 80))`. */
function expectedSeparator(): string {
  return separatorLine(process.stdout.columns || MAX_SEPARATOR_WIDTH);
}

// ── stdout capture helpers ─────────────────────────────────────────────

/** Invoke `fn` while recording every `process.stdout.write` chunk. */
function captureWrites(fn: () => void): string[] {
  const captured: string[] = [];
  const previous = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = previous;
  }
  return captured;
}

/** Concatenated output produced by calling `renderer.update(state)`. */
function renderUpdate(state: TuiShellState): string {
  const renderer = createAnsiRenderer();
  return captureWrites(() => renderer.update(state)).join('');
}

/** Build a chat-mode state with the given messages. */
function chatStateWith(messages: Message[]): TuiShellState {
  return { ...createInitialState('/test/ws'), mode: 'chat', messages };
}

function msg(type: Message['type'], text: string, id = 'm1'): Message {
  return { id, type, text, timestamp: 1 };
}

// ── createAnsiRenderer surface ─────────────────────────────────────────

describe('createAnsiRenderer', () => {
  it('returns an object exposing the TuiRenderer interface', () => {
    const renderer = createAnsiRenderer();
    expect(renderer).toBeDefined();
    expect(typeof renderer.start).toBe('function');
    expect(typeof renderer.update).toBe('function');
  });

  it('creates distinct renderer instances', () => {
    const r1 = createAnsiRenderer();
    const r2 = createAnsiRenderer();
    expect(r1).not.toBe(r2);
  });
});

// ── update(): frame composition (characterization) ─────────────────────

describe('update() frame rendering', () => {
  it('renders the exact frame for an empty chat state', () => {
    // clearScreen() + each line + CRLF + the renderScreen prompt + the
    // second prompt appended by update().
    const expected = buildEmptyChatFrame('/test/ws');

    const out = renderUpdate({ ...createInitialState('/test/ws'), mode: 'chat' });
    expect(out).toBe(expected);
  });

  it('always starts with a clear-screen sequence', () => {
    const out = renderUpdate({ ...createInitialState('/test/ws'), mode: 'chat' });
    expect(out.startsWith(CLEAR_SCREEN)).toBe(true);
  });

  it('emits a clear-screen + full frame on every update call', () => {
    const renderer = createAnsiRenderer();
    const chunks = captureWrites(() => {
      renderer.update({ ...createInitialState('/test/ws'), mode: 'chat' });
      renderer.update({ ...createInitialState('/test/ws'), mode: 'chat' });
    });
    const joined = chunks.join('');
    // Two clear-screen sequences => the screen was fully re-rendered twice.
    const clearScreenCount = joined.split(CLEAR_SCREEN).length - 1;
    expect(clearScreenCount).toBe(2);
  });

  it('omits the empty-state hint once at least one message exists', () => {
    const out = renderUpdate(chatStateWith([msg('user', 'hello')]));
    expect(out).not.toContain(EMPTY_STATE_HINT);
    expect(out).toContain(messageLine('user', 'hello'));
  });

  it('wraps every line with CRLF and renders the double prompt for chat mode', () => {
    const out = renderUpdate(chatStateWith([msg('user', 'hi')]));
    const lines = out.split('\r\n');
    expect(lines.length).toBeGreaterThan(3);
    expect(out.endsWith(DOUBLE_PROMPT)).toBe(true);
  });
});

// ── Message rendering ──────────────────────────────────────────────────

describe('message rendering', () => {
  it('renders a distinct ANSI-colored prefix per message type', () => {
    const state = chatStateWith([
      msg('user', 'who are you'),
      msg('assistant', 'iTestAgent here'),
      msg('error', 'boom'),
      msg('system', 'note'),
    ]);
    const out = renderUpdate(state);
    // Order must be preserved.
    const expected =
      `${messageLine('user', 'who are you')}\r\n` +
      `${messageLine('assistant', 'iTestAgent here')}\r\n` +
      `${messageLine('error', 'boom')}\r\n` +
      `${messageLine('system', 'note')}\r\n`;
    expect(out).toContain(expected);
  });

  it('renders the message text verbatim (no wrapping or truncation)', () => {
    const longText = 'a'.repeat(500);
    const out = renderUpdate(chatStateWith([msg('user', longText)]));
    expect(out).toContain(messageLine('user', longText));
    // The renderer never wraps: the entire message lives on a single line.
    expect(out.split('\r\n').filter((l) => l.includes('a'.repeat(50)))).toHaveLength(1);
  });

  it('renders an empty message text as a trailing-space bracket', () => {
    const out = renderUpdate(chatStateWith([msg('system', '')]));
    expect(out).toContain(emptyMessageLineTail('system'));
  });

  it('falls back to the dim SYS prefix for unknown message types', () => {
    const unknown = msg('user', 'x') as Message;
    const out = renderUpdate(chatStateWith([{ ...unknown, type: 'mystery' as Message['type'] }]));
    expect(out).toContain(messageLine('mystery', 'x'));
  });
});

// ── Mode indicators ────────────────────────────────────────────────────

describe('mode indicators', () => {
  it('renders the candidate_review hint line', () => {
    const out = renderUpdate({
      ...createInitialState('/test/ws'),
      mode: 'candidate_review',
      messages: [msg('assistant', 'paths found')],
    });
    expect(out).toContain(MODE_HINT_LINES.candidate_review);
  });

  it('renders the plan_review hint line', () => {
    const out = renderUpdate({
      ...createInitialState('/test/ws'),
      mode: 'plan_review',
      messages: [msg('assistant', 'plan ready')],
    });
    expect(out).toContain(MODE_HINT_LINES.plan_review);
  });

  it('renders no mode-specific block for recording_review', () => {
    const state = {
      ...createInitialState('/test/ws'),
      mode: 'recording_review' as const,
      messages: [msg('assistant', 'recording')],
    };
    const out = renderUpdate(state);
    // Frame must be identical to the chat-mode frame for the same messages.
    const chatOut = renderUpdate(chatStateWith(state.messages as Message[]));
    expect(out).toBe(chatOut);
  });

  it('renders no mode-specific block for credential_prompt', () => {
    const state = {
      ...createInitialState('/test/ws'),
      mode: 'credential_prompt' as const,
      messages: [msg('assistant', 'need creds')],
    };
    const out = renderUpdate(state);
    const chatOut = renderUpdate(chatStateWith(state.messages as Message[]));
    expect(out).toBe(chatOut);
  });
});

// ── Setup wizard panel ─────────────────────────────────────────────────

function setupState(step: number, overrides: Partial<TuiShellState> = {}): TuiShellState {
  return {
    ...createInitialState('/test/ws'),
    mode: 'setup',
    setupStep: step,
    setupProvider: 'openai',
    setupBaseUrl: 'https://api.example.com/v1',
    setupModel: 'gpt-4o-mini',
    setupError: '',
    ...overrides,
  };
}

describe('setup mode panel', () => {
  it('renders the First-Time Setup header (bold + cyan) with dim subtitle', () => {
    const out = renderUpdate(setupState(0));
    expect(out).toContain(SETUP_PANEL.header);
    expect(out).toContain(SETUP_PANEL.subtitle);
    expect(out).toContain(SETUP_PANEL.exitHint);
  });

  it('step 0 renders the API Base URL field with the default', () => {
    const out = renderUpdate(setupState(0));
    expect(out).toContain(SETUP_PANEL.steps[0].field);
    expect(out).toContain(SETUP_PANEL.steps[0].defaultLine('https://api.example.com/v1'));
    expect(out).toContain(SETUP_PANEL.steps[0].hint);
  });

  it('step 1 renders the API Key field and hides the base URL', () => {
    const out = renderUpdate(setupState(1));
    expect(out).toContain(SETUP_PANEL.steps[1].field);
    expect(out).toContain(SETUP_PANEL.steps[1].hiddenNote);
    expect(out).not.toContain('API Base URL');
    expect(out).not.toContain('Model Name');
  });

  it('step 2 renders the Model Name field with the default', () => {
    const out = renderUpdate(setupState(2));
    expect(out).toContain(SETUP_PANEL.steps[2].field);
    expect(out).toContain(SETUP_PANEL.steps[2].defaultLine('gpt-4o-mini'));
    expect(out).toContain(SETUP_PANEL.steps[2].hint);
  });

  it('renders a setup error in red on the current step', () => {
    const out = renderUpdate(setupState(1, { setupError: 'Invalid API key' }));
    expect(out).toContain(SETUP_PANEL.errorLine('Invalid API key'));
  });

  it('suppresses the renderScreen prompt but update() still appends one', () => {
    const out = renderUpdate(setupState(0));
    // renderScreen writes '' for setup; only update() appends '> '.
    expect(out.endsWith('> ')).toBe(true);
    expect(out).not.toContain(DOUBLE_PROMPT);
  });
});

// ── Terminal width behavior ────────────────────────────────────────────

describe('terminal width behavior', () => {
  it('caps the separator at 80 columns regardless of a wider terminal', () => {
    // columns is undefined in the test env → renderer falls back to 80.
    const out = renderUpdate({ ...createInitialState('/test/ws'), mode: 'chat' });
    expect(out).toContain(`${separatorLine(MAX_SEPARATOR_WIDTH)}\r\n`);
  });

  it('clamps the separator to the available columns when narrower than 80', () => {
    try {
      Object.defineProperty(process.stdout, 'columns', { value: 20, configurable: true });
      const out = renderUpdate({ ...createInitialState('/test/ws'), mode: 'chat' });
      expect(out).toContain(`${separatorLine(20)}\r\n`);
      expect(out).not.toContain(`${separatorLine(21)}\r\n`);
    } finally {
      try {
        Object.defineProperty(process.stdout, 'columns', {
          value: undefined,
          configurable: true,
        });
      } catch {
        // ignore restore failure
      }
    }
  });
});

// ── B27: extracted layout module (src/ansi-layout.ts) ─────────────────

describe('ansi-layout', () => {
  it('exposes the same separator computation the renderer has always used', () => {
    expect(layoutSeparatorLine(undefined)).toBe(separatorLine(MAX_SEPARATOR_WIDTH));
    expect(layoutSeparatorLine(120)).toBe(SEPARATOR_CHAR.repeat(80));
    expect(layoutSeparatorLine(20)).toBe(SEPARATOR_CHAR.repeat(20));
  });

  it('effectiveColumns falls back to 80 for undefined and zero widths', () => {
    expect(effectiveColumns(undefined)).toBe(MAX_SEPARATOR_WIDTH);
    expect(effectiveColumns(0)).toBe(MAX_SEPARATOR_WIDTH);
    expect(effectiveColumns(20)).toBe(20);
    expect(effectiveColumns(200)).toBe(200);
  });

  it('keeps the chat prompt constant in sync with the characterization lock', () => {
    expect(CHAT_PROMPT).toBe('> ');
  });
});

// ── B27: extracted frame module (src/renderers/ansi-renderer-frame.ts) ──

/** Minimal write target capturing every chunk, mirroring process.stdout.write. */
function makeFakeWriter(): { chunks: string[]; target: FrameWriteTarget } {
  const chunks: string[] = [];
  return {
    chunks,
    target: {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    },
  };
}

describe('renderFrame (extracted from ansi-renderer render())', () => {
  it('returns the frame lines without any escape-sequence framing or prompt', () => {
    const lines = renderFrame(chatStateWith([msg('user', 'hello')]));
    expect(Array.isArray(lines)).toBe(true);
    expect(lines[0]).toBe(HEADER_TITLE);
    expect(lines[1]).toBe(headerWorkspaceLine('/test/ws'));
    expect(lines[2]).toBe(separatorLine(MAX_SEPARATOR_WIDTH));
    expect(lines).toContain(messageLine('user', 'hello'));
    expect(lines).not.toContain('> ');
  });

  it('matches the fixture-built body of the empty chat frame byte for byte', () => {
    const lines = renderFrame({ ...createInitialState('/test/ws'), mode: 'chat' });
    const expectedBody = buildEmptyChatFrame('/test/ws')
      .replace(CLEAR_SCREEN, '')
      .replace(DOUBLE_PROMPT, '');
    expect(`${lines.map((l) => `${l}\r\n`).join('')}`).toBe(expectedBody);
  });

  it('emits mode hint lines for candidate_review and plan_review', () => {
    expect(
      renderFrame({
        ...createInitialState('/test/ws'),
        mode: 'candidate_review',
        messages: [msg('assistant', 'paths')],
      }),
    ).toContain(MODE_HINT_LINES.candidate_review);
    expect(
      renderFrame({
        ...createInitialState('/test/ws'),
        mode: 'plan_review',
        messages: [msg('assistant', 'plan')],
      }),
    ).toContain(MODE_HINT_LINES.plan_review);
  });

  it('renders the setup panel steps exactly as characterized', () => {
    const lines = renderFrame(setupState(1));
    expect(lines).toContain(SETUP_PANEL.header);
    expect(lines).toContain(SETUP_PANEL.steps[1].field);
    expect(lines).toContain(SETUP_PANEL.steps[1].hiddenNote);
  });
});

describe('renderScreen / clearScreen (stdout writing)', () => {
  it('clearScreen writes exactly the clear-screen sequence', () => {
    const { chunks, target } = makeFakeWriter();
    clearScreen(target);
    expect(chunks).toEqual([CLEAR_SCREEN]);
  });

  it('writes CLEAR_SCREEN first, one CRLF-terminated chunk per line, then the prompt', () => {
    const { chunks, target } = makeFakeWriter();
    renderScreen(chatStateWith([msg('user', 'hi')]), target);
    expect(chunks[0]).toBe(CLEAR_SCREEN);
    expect(chunks[chunks.length - 1]).toBe(CHAT_PROMPT);
    for (const chunk of chunks.slice(1, -1)) {
      expect(chunk.endsWith('\r\n')).toBe(true);
    }
    const joined = chunks.join('');
    expect(joined.endsWith(`${CHAT_PROMPT}`)).toBe(true);
    expect(joined.startsWith(CLEAR_SCREEN)).toBe(true);
  });

  it('suppresses the prompt entirely (writes "") for setup mode', () => {
    const { chunks, target } = makeFakeWriter();
    renderScreen(setupState(0), target);
    expect(chunks[chunks.length - 1]).toBe('');
    expect(chunks).not.toContain('> ');
  });

  it('defaults to process.stdout when no write target is given', () => {
    const captured: string[] = [];
    const previous = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      renderScreen(chatStateWith([msg('user', 'default-out')]));
    } finally {
      process.stdout.write = previous;
    }
    expect(captured[0]).toBe(CLEAR_SCREEN);
    expect(captured.join('')).toContain(messageLine('user', 'default-out'));
  });
});
