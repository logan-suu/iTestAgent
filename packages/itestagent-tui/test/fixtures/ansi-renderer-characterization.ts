/**
 * Characterization fixtures for the ANSI terminal renderer
 * (src/renderers/ansi-renderer.ts).
 *
 * These constants and builders capture the EXACT byte-level output the
 * renderer currently produces, extracted from the pre-refactor test suite.
 * They are expected values only — they must never import or re-implement
 * renderer logic. If a later batch (B27) changes ansi-renderer.ts, these
 * snapshots define the behavior contract those changes are measured against.
 */

// ── ANSI escape constants (mirroring src/renderers/ansi-renderer.ts) ──

export const CSI = '\x1b[';
export const RESET = '\x1b[0m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
export const CYAN = '\x1b[36m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';

// ── Frame scaffolding ─────────────────────────────────────────────────

/** clearScreen() emits cursor-home + erase-entire-screen in this order. */
export const CLEAR_SCREEN = `${CSI}2J${CSI}H`;

/** Prompt written by renderScreen() for non-setup modes. */
export const CHAT_PROMPT = '> ';

/** update() appends a second prompt after renderScreen() already wrote one. */
export const DOUBLE_PROMPT = '> > ';

/** Hint line shown when the message list is empty. */
export const EMPTY_STATE_HINT = 'Type a message and press Enter.';

/** Separator glyph and width cap used by the renderer. */
export const SEPARATOR_CHAR = '─';
export const MAX_SEPARATOR_WIDTH = 80;

/**
 * The separator is `'─'.repeat(Math.min(process.stdout.columns || 80, 80))`.
 * Pass the effective column count (or omit for the 80-column fallback).
 */
export function separatorLine(columns?: number): string {
  return SEPARATOR_CHAR.repeat(Math.min(columns ?? MAX_SEPARATOR_WIDTH, MAX_SEPARATOR_WIDTH));
}

// ── Header block ──────────────────────────────────────────────────────

export const HEADER_TITLE = `${BOLD}iTestAgent v0.0.1${RESET}`;
export function headerWorkspaceLine(workspace: string): string {
  return `${DIM}${workspace}${RESET}`;
}

// ── Message rendering ─────────────────────────────────────────────────

/** Per-type colored prefixes; unknown types fall back to the dim SYS prefix. */
export const MESSAGE_PREFIXES = {
  user: `${GREEN}YOU${RESET}`,
  assistant: `${CYAN} AI${RESET}`,
  error: `${RED}ERR${RESET}`,
  system: `${DIM}SYS${RESET}`,
} as const;

export type CharacterizedMessageType = keyof typeof MESSAGE_PREFIXES;

/** Exact rendered line for a message; unknown types use the SYS prefix. */
export function messageLine(type: string, text: string): string {
  const prefix =
    type === 'user'
      ? MESSAGE_PREFIXES.user
      : type === 'assistant'
        ? MESSAGE_PREFIXES.assistant
        : type === 'error'
          ? MESSAGE_PREFIXES.error
          : MESSAGE_PREFIXES.system;
  return `[${prefix}] ${text}`;
}

/** Empty-text messages still emit the bracket plus a trailing space. */
export function emptyMessageLineTail(type: CharacterizedMessageType): string {
  return `[${MESSAGE_PREFIXES[type]}] \r\n`;
}

// ── Mode indicator lines ──────────────────────────────────────────────

export const MODE_HINT_LINES = {
  candidate_review: `${YELLOW}[Candidate Review]${RESET} j/k to navigate, Space to toggle, Enter to confirm`,
  plan_review: `${YELLOW}[Plan Review]${RESET} j/k to navigate, Enter to confirm, q to cancel`,
} as const;

// ── Setup wizard panel ────────────────────────────────────────────────

export const SETUP_PANEL = {
  header: `${BOLD}${CYAN}First-Time Setup${RESET}`,
  subtitle: `${DIM}Configure your AI provider to get started.${RESET}`,
  exitHint: `${DIM}Ctrl+C to exit setup at any time.${RESET}`,
  steps: [
    {
      field: `${BOLD}API Base URL${RESET}`,
      defaultLine: (value: string): string => `${DIM}Default: ${value}${RESET}`,
      hint: 'Press Enter to accept default, or type a custom URL.',
    },
    {
      field: `${BOLD}API Key${RESET}`,
      hiddenNote: `${DIM}Paste your API key (input is hidden):${RESET}`,
    },
    {
      field: `${BOLD}Model Name${RESET}`,
      defaultLine: (value: string): string => `${DIM}Default: ${value}${RESET}`,
      hint: 'Press Enter to accept default, or type a custom model name.',
    },
  ],
  /** setupError is rendered raw inside RED on the current step. */
  errorLine: (message: string): string => `${RED}${message}${RESET}`,
} as const;

// ── Full-frame builders ───────────────────────────────────────────────

/**
 * Exact bytes of `renderer.update(empty chat state)`:
 * clearScreen + frame lines (CRLF-terminated) + renderScreen prompt +
 * the second prompt appended by update().
 */
export function buildEmptyChatFrame(workspace: string, columns?: number): string {
  const sep = separatorLine(columns);
  const frameLines = [
    HEADER_TITLE,
    headerWorkspaceLine(workspace),
    sep,
    `${DIM}${EMPTY_STATE_HINT}${RESET}`,
    '',
    sep,
  ];
  return `${CLEAR_SCREEN}${frameLines.map((line) => `${line}\r\n`).join('')}${DOUBLE_PROMPT}`;
}
