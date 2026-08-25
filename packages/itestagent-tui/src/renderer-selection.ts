/**
 * Renderer selection policy for the TUI.
 *
 * B27: introduces a capability-based selector between the three TuiRenderer
 * implementations. This module is pure policy — wiring it into entry.ts is a
 * later batch (entry.ts is outside the B27 allowlist).
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
  const preferred = preferences.framework?.trim().toLowerCase();
  if (preferred && RENDERER_KINDS.has(preferred)) {
    return preferred as RendererKind;
  }

  if (!capabilities.isTTY) return 'ansi';
  if (capabilities.term === 'dumb') return 'ansi';
  if (capabilities.ci) return 'ink';
  return 'opentui';
}
