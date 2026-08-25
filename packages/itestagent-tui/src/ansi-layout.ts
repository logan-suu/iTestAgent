/**
 * ANSI layout constants and pure layout helpers for the ANSI renderer.
 *
 * B27: extracted from src/renderers/ansi-renderer.ts so frame composition
 * (ansi-renderer-frame.ts) and input handling (ansi-input.ts) share one
 * source of truth for escape codes and width math.
 *
 * Byte-level compatibility contract (locked by
 * test/fixtures/ansi-renderer-characterization.ts): the separator is
 * `'─'.repeat(Math.min(process.stdout.columns || 80, 80))`.
 */

export const CSI = '\x1b[';
export const RESET = '\x1b[0m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
export const CYAN = '\x1b[36m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';

/** Separator glyph used between frame sections. */
export const SEPARATOR_CHAR = '─';

/** Hard cap for the separator width, regardless of terminal size. */
export const MAX_SEPARATOR_WIDTH = 80;

/** Column fallback when the stream does not report a width. */
export const DEFAULT_COLUMNS = 80;

/** Prompt written by renderScreen() for non-setup modes. */
export const CHAT_PROMPT = '> ';

/**
 * Effective column count: `columns || process.stdout.columns || 80`.
 * Zero/undefined widths fall back to DEFAULT_COLUMNS (`||` semantics,
 * matching the pre-refactor renderer).
 */
export function effectiveColumns(columns?: number): number {
  const reported = columns ?? process.stdout.columns;
  return reported || DEFAULT_COLUMNS;
}

/** Separator width after clamping to MAX_SEPARATOR_WIDTH. */
export function separatorWidth(columns?: number): number {
  return Math.min(effectiveColumns(columns), MAX_SEPARATOR_WIDTH);
}

/** The horizontal separator line for the given (or current) terminal width. */
export function separatorLine(columns?: number): string {
  return SEPARATOR_CHAR.repeat(separatorWidth(columns));
}
