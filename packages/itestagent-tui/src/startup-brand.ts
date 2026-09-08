import type { Message, TuiShellState } from './tui-shell.js';

/** B31: TUI startup brand (promotion guide §11.3 'run routing/completion'). */
export function resolveStartupBrand(input: { name?: string } = {}): { name: string } {
  return { name: input.name ?? 'iTestAgent' };
}

// Fixed-width BMP block glyphs use one terminal cell each. Capitals span all four
// rows; the lowercase body sits one row lower on the same baseline.
const BLOCK_GLYPHS = {
  i: ['▀', '▄', '█', '▀'],
  T: ['▀▀█▀▀', '  █  ', '  █  ', '  ▀  '],
  e: ['    ', '█▀▀█', '█▀▀▀', '▀▀▀▀'],
  s: ['    ', '█▀▀▀', '▀▀▀█', '▀▀▀▀'],
  t: [' ▄  ', '▀█▀ ', ' █  ', ' ▀▀ '],
  A: ['█▀▀█', '█  █', '█▀▀█', '▀  ▀'],
  g: ['    ', '█▀▀█', '█▄▄█', '▄▄▄█'],
  n: ['    ', '█▀▀▄', '█  █', '▀  ▀'],
  S: ['█▀▀▀', '█▄▄▄', '   █', '▀▀▀▀'],
  U: ['█  █', '█  █', '█  █', '▀▀▀▀'],
  C: ['█▀▀▀', '█   ', '█   ', '▀▀▀▀'],
  E: ['█▀▀▀', '█▀▀ ', '█   ', '▀▀▀▀'],
} as const;

function blockWordmark(letters: readonly (keyof typeof BLOCK_GLYPHS)[]): readonly string[] {
  return Array.from({ length: 4 }, (_, row) =>
    letters.map((letter) => BLOCK_GLYPHS[letter][row]).join(' '),
  );
}

export const STARTUP_BRAND_COLOR = '#8bd5ca';
export const STARTUP_LOGO = blockWordmark(['i', 'T', 'e', 's', 't', 'A', 'g', 'e', 'n', 't']);
export const SUCCESS_LOGO = blockWordmark(['S', 'U', 'C', 'C', 'E', 'S', 'S']);
export const STARTUP_LOGO_WIDTH = Math.max(...STARTUP_LOGO.map((line) => line.length));
export const SUCCESS_LOGO_WIDTH = Math.max(...SUCCESS_LOGO.map((line) => line.length));

type TerminalDimensions = { width: number; height: number };

/** Presentation trusts structured run metadata, never matching words in message text. */
export function isSuccessfulRunMessage(message: Message): boolean {
  return message.type === 'system' && message.runStatus === 'passed';
}

/** Split only trusted completion messages; ordinary multiline messages stay intact. */
export function completionMessageParts(message: Message): { heading: string; details: string } {
  const newline = message.text.indexOf('\n');
  if (!isSuccessfulRunMessage(message) || newline < 0) {
    return { heading: message.text, details: '' };
  }
  return { heading: message.text.slice(0, newline), details: message.text.slice(newline + 1) };
}

/** A scrollable transcript budgets its viewport, never the accumulated history. */
export function successBrandLinesInViewport(
  message: Message,
  viewport: TerminalDimensions,
): readonly string[] {
  if (!isSuccessfulRunMessage(message)) return [];
  // Reserve horizontal breathing room, padding, and context around the four-row art.
  return viewport.width >= SUCCESS_LOGO_WIDTH + 6 && viewport.height >= SUCCESS_LOGO.length + 8
    ? SUCCESS_LOGO
    : ['SUCCESS'];
}

/** Keep the report readable when the terminal cannot fit the decorative banner. */
export function successBrandLines(
  message: Message,
  dimensions: TerminalDimensions,
  messages: readonly Message[] = [message],
): readonly string[] {
  if (!isSuccessfulRunMessage(message)) return [];
  const contentWidth = Math.max(1, dimensions.width - 8);
  const transcriptRows = messages.reduce(
    (sum, entry) =>
      sum +
      entry.text
        .split('\n')
        .reduce(
          (rows, line) => rows + Math.max(1, Math.ceil((Bun.stringWidth(line) + 6) / contentWidth)),
          0,
        ) +
      (isSuccessfulRunMessage(entry) ? SUCCESS_LOGO.length : 0),
    0,
  );
  // Reserve the header, input, borders and spacing. Budget every success banner
  // together so multiple saved runs cannot each assume the same free rows.
  const minimumHeight = Math.max(28, 18 + transcriptRows);
  if (dimensions.width < SUCCESS_LOGO_WIDTH + 8 || dimensions.height < minimumHeight) {
    return ['SUCCESS'];
  }
  return SUCCESS_LOGO;
}

export function showStartupBrand(state: TuiShellState): boolean {
  if (state.mode === 'setup') return true;
  return (
    state.mode === 'chat' &&
    !state.agentActivity &&
    !state.messages.some(
      (message) => message.type === 'user' || message.type === 'assistant' || message.runStatus,
    )
  );
}

/** Keep setup disclosures, status, and the input prompt ahead of decorative height. */
export function startupBrandLines(
  state: TuiShellState,
  dimensions: TerminalDimensions,
): readonly string[] {
  if (!showStartupBrand(state)) return [];
  const contentWidth = Math.max(1, dimensions.width - 8);
  const messageRows = state.messages.reduce(
    (sum, message) =>
      sum +
      message.text.split('\n').reduce((rows, line) => {
        const columns = [...line].reduce(
          (width, character) => width + (character.charCodeAt(0) > 255 ? 2 : 1),
          6,
        );
        return rows + Math.max(1, Math.ceil(columns / contentWidth));
      }, 0),
    0,
  );
  const minimumHeight = (state.mode === 'setup' ? 36 : 28) + messageRows;
  if (dimensions.width < STARTUP_LOGO_WIDTH + 8 || dimensions.height < minimumHeight) {
    return ['iTestAgent'];
  }
  return STARTUP_LOGO;
}
