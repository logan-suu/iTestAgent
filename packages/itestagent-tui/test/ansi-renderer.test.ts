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
 */

import { describe, expect, it } from 'bun:test';
import { createAnsiRenderer } from '../src/renderers/ansi-renderer.js';
import { type Message, type TuiShellState, createInitialState } from '../src/tui-shell.js';

// ── ANSI constants mirroring src/renderers/ansi-renderer.ts ────────────
const CSI = '\x1b[';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

/** Same separator computation as the renderer: `Math.min(cols, 80)`. */
function expectedSeparator(): string {
  return '─'.repeat(Math.min(process.stdout.columns || 80, 80));
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
    const sep = expectedSeparator();
    const frameLines = [
      `${BOLD}iTestAgent v0.0.1${RESET}`, // header
      `${DIM}/test/ws${RESET}`, // workspace
      sep, // top separator
      `${DIM}Type a message and press Enter.${RESET}`, // empty hint
      '', // blank line
      sep, // bottom separator
    ];
    // clearScreen() + each line + CRLF + the renderScreen prompt + the
    // second prompt appended by update().
    const expected = `${CSI}2J${CSI}H${frameLines.map((line) => `${line}\r\n`).join('')}> > `;

    const out = renderUpdate({ ...createInitialState('/test/ws'), mode: 'chat' });
    expect(out).toBe(expected);
  });

  it('always starts with a clear-screen sequence', () => {
    const out = renderUpdate({ ...createInitialState('/test/ws'), mode: 'chat' });
    expect(out.startsWith(`${CSI}2J${CSI}H`)).toBe(true);
  });

  it('emits a clear-screen + full frame on every update call', () => {
    const renderer = createAnsiRenderer();
    const chunks = captureWrites(() => {
      renderer.update({ ...createInitialState('/test/ws'), mode: 'chat' });
      renderer.update({ ...createInitialState('/test/ws'), mode: 'chat' });
    });
    const joined = chunks.join('');
    // Two clear-screen sequences => the screen was fully re-rendered twice.
    const clearScreenCount = joined.split(`${CSI}2J${CSI}H`).length - 1;
    expect(clearScreenCount).toBe(2);
  });

  it('omits the empty-state hint once at least one message exists', () => {
    const out = renderUpdate(chatStateWith([msg('user', 'hello')]));
    expect(out).not.toContain('Type a message and press Enter.');
    expect(out).toContain(`[${GREEN}YOU${RESET}] hello`);
  });

  it('wraps every line with CRLF and renders the double prompt for chat mode', () => {
    const out = renderUpdate(chatStateWith([msg('user', 'hi')]));
    const lines = out.split('\r\n');
    expect(lines.length).toBeGreaterThan(3);
    expect(out.endsWith('> > ')).toBe(true);
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
      `[${GREEN}YOU${RESET}] who are you\r\n` +
      `[${CYAN} AI${RESET}] iTestAgent here\r\n` +
      `[${RED}ERR${RESET}] boom\r\n` +
      `[${DIM}SYS${RESET}] note\r\n`;
    expect(out).toContain(expected);
  });

  it('renders the message text verbatim (no wrapping or truncation)', () => {
    const longText = 'a'.repeat(500);
    const out = renderUpdate(chatStateWith([msg('user', longText)]));
    expect(out).toContain(`[${GREEN}YOU${RESET}] ${longText}`);
    // The renderer never wraps: the entire message lives on a single line.
    expect(out.split('\r\n').filter((l) => l.includes('a'.repeat(50)))).toHaveLength(1);
  });

  it('renders an empty message text as a trailing-space bracket', () => {
    const out = renderUpdate(chatStateWith([msg('system', '')]));
    expect(out).toContain(`[${DIM}SYS${RESET}] \r\n`);
  });

  it('falls back to the dim SYS prefix for unknown message types', () => {
    const unknown = msg('user', 'x') as Message;
    const out = renderUpdate(chatStateWith([{ ...unknown, type: 'mystery' as Message['type'] }]));
    expect(out).toContain(`[${DIM}SYS${RESET}] x`);
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
    expect(out).toContain(
      `${YELLOW}[Candidate Review]${RESET} j/k to navigate, Space to toggle, Enter to confirm`,
    );
  });

  it('renders the plan_review hint line', () => {
    const out = renderUpdate({
      ...createInitialState('/test/ws'),
      mode: 'plan_review',
      messages: [msg('assistant', 'plan ready')],
    });
    expect(out).toContain(
      `${YELLOW}[Plan Review]${RESET} j/k to navigate, Enter to confirm, q to cancel`,
    );
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
    expect(out).toContain(`${BOLD}${CYAN}First-Time Setup${RESET}`);
    expect(out).toContain(`${DIM}Configure your AI provider to get started.${RESET}`);
    expect(out).toContain(`${DIM}Ctrl+C to exit setup at any time.${RESET}`);
  });

  it('step 0 renders the API Base URL field with the default', () => {
    const out = renderUpdate(setupState(0));
    expect(out).toContain(`${BOLD}API Base URL${RESET}`);
    expect(out).toContain(`${DIM}Default: https://api.example.com/v1${RESET}`);
    expect(out).toContain('Press Enter to accept default, or type a custom URL.');
  });

  it('step 1 renders the API Key field and hides the base URL', () => {
    const out = renderUpdate(setupState(1));
    expect(out).toContain(`${BOLD}API Key${RESET}`);
    expect(out).toContain(`${DIM}Paste your API key (input is hidden):${RESET}`);
    expect(out).not.toContain('API Base URL');
    expect(out).not.toContain('Model Name');
  });

  it('step 2 renders the Model Name field with the default', () => {
    const out = renderUpdate(setupState(2));
    expect(out).toContain(`${BOLD}Model Name${RESET}`);
    expect(out).toContain(`${DIM}Default: gpt-4o-mini${RESET}`);
    expect(out).toContain('Press Enter to accept default, or type a custom model name.');
  });

  it('renders a setup error in red on the current step', () => {
    const out = renderUpdate(setupState(1, { setupError: 'Invalid API key' }));
    expect(out).toContain(`${RED}Invalid API key${RESET}`);
  });

  it('suppresses the renderScreen prompt but update() still appends one', () => {
    const out = renderUpdate(setupState(0));
    // renderScreen writes '' for setup; only update() appends '> '.
    expect(out.endsWith('> ')).toBe(true);
    expect(out).not.toContain('> > ');
  });
});

// ── Terminal width behavior ────────────────────────────────────────────

describe('terminal width behavior', () => {
  it('caps the separator at 80 columns regardless of a wider terminal', () => {
    // columns is undefined in the test env → renderer falls back to 80.
    const out = renderUpdate({ ...createInitialState('/test/ws'), mode: 'chat' });
    expect(out).toContain(`${'─'.repeat(80)}\r\n`);
  });

  it('clamps the separator to the available columns when narrower than 80', () => {
    try {
      Object.defineProperty(process.stdout, 'columns', { value: 20, configurable: true });
      const out = renderUpdate({ ...createInitialState('/test/ws'), mode: 'chat' });
      expect(out).toContain(`${'─'.repeat(20)}\r\n`);
      expect(out).not.toContain(`${'─'.repeat(21)}\r\n`);
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
