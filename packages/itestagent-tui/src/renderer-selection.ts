/**
 * Renderer selection policy for the TUI.
 *
 * ADR-036: selection is explicit and observable. `auto` uses terminal
 * capabilities plus the renderer that passed the current real-PTY gate.
 *
 * Policy (in order):
 *   1. A recognized `framework` preference ('opentui' | 'ink' | 'ansi',
 *      case-insensitive) always wins — explicit operator config beats
 *      auto-detection, even without a TTY.
 *   2. Non-TTY streams cannot run raw-mode/alt-screen renderers → 'ansi'.
 *   3. TERM=dumb → 'ansi'.
 *   4. CI environments → 'ink' (deterministic, widest compatibility).
 *   5. Otherwise → 'opentui' (target mainline per ADR-008).
 */

export type RendererKind = 'opentui' | 'ink' | 'ansi';
export type RendererPreference = 'auto' | RendererKind;

export interface RendererSelection {
  readonly kind: RendererKind;
  readonly preference: RendererPreference;
  readonly explicit: boolean;
  readonly reason: string;
}

/** Terminal capabilities relevant to renderer selection. */
export interface TerminalCapabilities {
  /** Whether stdin is an interactive terminal. */
  readonly isTTY: boolean;
  /** TERM environment value ('' when unset). */
  readonly term: string;
  /** COLORTERM environment value ('' when unset). */
  readonly colorterm: string;
  /** Whether the process looks like it runs in CI. */
  readonly ci: boolean;
}

/** Operator preferences (from config `tui.framework`). */
export interface RendererPreferences {
  readonly framework?: string;
}

const RENDERER_KINDS: ReadonlySet<string> = new Set(['opentui', 'ink', 'ansi']);

/** Updated only after the matching package version passes the real-PTY matrix. */
export const VERIFIED_INTERACTIVE_RENDERER: RendererKind = 'opentui';

/** True only for unambiguous CI markers ('true' / '1'). */
function parseCiFlag(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/** Detect capabilities from a stdin-like stream and an env-like record. */
export function detectCapabilities(io: {
  stdin: { isTTY?: boolean };
  env: Record<string, string | undefined>;
}): TerminalCapabilities {
  return {
    isTTY: io.stdin.isTTY === true,
    term: io.env.TERM ?? '',
    colorterm: io.env.COLORTERM ?? '',
    ci: parseCiFlag(io.env.CI),
  };
}

/** Detect capabilities from the current process. */
export function detectProcessCapabilities(): TerminalCapabilities {
  return detectCapabilities({ stdin: process.stdin, env: process.env });
}

/**
 * Select the renderer kind for the given capabilities and preferences.
 * Deterministic and side-effect free.
 */
export function selectRenderer(
  capabilities: TerminalCapabilities,
  preferences: RendererPreferences = {},
): RendererKind {
  return selectRendererWithReason(capabilities, preferences).kind;
}

export function selectRendererWithReason(
  capabilities: TerminalCapabilities,
  preferences: RendererPreferences = {},
): RendererSelection {
  const preferred = preferences.framework?.trim().toLowerCase();
  if (preferred && RENDERER_KINDS.has(preferred)) {
    return {
      kind: preferred as RendererKind,
      preference: preferred as RendererKind,
      explicit: true,
      reason: `explicit tui.framework=${preferred}`,
    };
  }

  const preference: RendererPreference = 'auto';
  if (!capabilities.isTTY) {
    return { kind: 'ansi', preference, explicit: false, reason: 'auto: stdin is not a TTY' };
  }
  if (capabilities.term === 'dumb') {
    return { kind: 'ansi', preference, explicit: false, reason: 'auto: TERM=dumb' };
  }
  if (capabilities.ci) {
    return { kind: 'ink', preference, explicit: false, reason: 'auto: CI compatibility' };
  }
  return {
    kind: VERIFIED_INTERACTIVE_RENDERER,
    preference,
    explicit: false,
    reason: `auto: ${VERIFIED_INTERACTIVE_RENDERER} passed the real-PTY gate`,
  };
}
