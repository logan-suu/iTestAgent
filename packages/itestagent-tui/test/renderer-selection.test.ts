/**
 * Tests for src/renderer-selection.ts — renderer selection policy.
 *
 * B27 introduces a capability-based selector that decides between the three
 * TuiRenderer implementations ('opentui' target mainline per ADR-008, 'ink'
 * verified fallback, 'ansi' zero-dependency last resort). Selection is pure
 * and deterministic: explicit config wins, then hard-capability fallbacks.
 *
 * Policy (documented in renderer-selection.ts):
 *   1. A recognized `framework` preference ('opentui'|'ink'|'ansi',
 *      case-insensitive) always wins.
 *   2. Non-TTY streams cannot run raw-mode renderers → 'ansi'.
 *   3. TERM=dumb → 'ansi'.
 *   4. CI environments → 'ink' (deterministic, widest compatibility).
 *   5. Otherwise → 'opentui' (target mainline).
 */

import { describe, expect, it } from 'bun:test';
import {
  type RendererKind,
  type TerminalCapabilities,
  detectCapabilities,
  selectRenderer,
} from '../src/renderer-selection.js';

function caps(overrides: Partial<TerminalCapabilities> = {}): TerminalCapabilities {
  return { isTTY: true, term: 'xterm-256color', colorterm: 'truecolor', ci: false, ...overrides };
}

describe('selectRenderer — explicit preference wins', () => {
  it('honors an explicit opentui preference', () => {
    expect(selectRenderer(caps(), { framework: 'opentui' })).toBe('opentui');
  });

  it('honors an explicit ink preference even on a capable terminal', () => {
    expect(selectRenderer(caps(), { framework: 'ink' })).toBe('ink');
  });

  it('honors an explicit ansi preference even on a capable terminal', () => {
    expect(selectRenderer(caps(), { framework: 'ansi' })).toBe('ansi');
  });

  it('is case-insensitive for the framework preference', () => {
    expect(selectRenderer(caps(), { framework: 'OpenTUI' })).toBe('opentui');
    expect(selectRenderer(caps(), { framework: 'INK' })).toBe('ink');
  });

  it('ignores unknown framework values and falls through to auto-detection', () => {
    // Unknown config must not crash selection; CI-less capable term → opentui.
    expect(selectRenderer(caps(), { framework: 'reziframework' })).toBe('opentui');
  });

  it('explicit preference overrides a non-TTY environment', () => {
    // Configured explicitly → trust the operator even without a TTY.
    expect(selectRenderer(caps({ isTTY: false }), { framework: 'ink' })).toBe('ink');
  });
});

describe('selectRenderer — capability fallbacks', () => {
  it('selects ansi when the output stream is not a TTY', () => {
    expect(selectRenderer(caps({ isTTY: false }))).toBe('ansi');
  });

  it('selects ansi for TERM=dumb regardless of other capabilities', () => {
    expect(selectRenderer(caps({ term: 'dumb' }))).toBe('ansi');
  });

  it('selects ink in CI environments', () => {
    expect(selectRenderer(caps({ ci: true }))).toBe('ink');
  });

  it('CI does not override TERM=dumb (dumb terminals stay ansi)', () => {
    expect(selectRenderer(caps({ ci: true, term: 'dumb' }))).toBe('ansi');
  });

  it('defaults to opentui on a capable interactive terminal (ADR-008 mainline)', () => {
    expect(selectRenderer(caps())).toBe<RendererKind>('opentui');
  });

  it('treats missing preferences identically to empty preferences', () => {
    expect(selectRenderer(caps())).toBe(selectRenderer(caps(), {}));
  });
});

describe('detectCapabilities', () => {
  it('reads TTY flag, TERM, COLORTERM and CI from the provided io sources', () => {
    const detected = detectCapabilities({
      stdin: { isTTY: true },
      env: { TERM: 'xterm-256color', COLORTERM: 'truecolor', CI: 'true' },
    });
    expect(detected).toEqual({
      isTTY: true,
      term: 'xterm-256color',
      colorterm: 'truecolor',
      ci: true,
    });
  });

  it('normalizes missing env vars to empty strings and isTTY to false', () => {
    const detected = detectCapabilities({ stdin: {}, env: {} });
    expect(detected).toEqual({ isTTY: false, term: '', colorterm: '', ci: false });
  });

  it('treats CI=1 as a CI environment', () => {
    const detected = detectCapabilities({ stdin: {}, env: { CI: '1' } });
    expect(detected.ci).toBe(true);
  });

  it('does not treat CI=false as a CI environment', () => {
    const detected = detectCapabilities({ stdin: {}, env: { CI: 'false' } });
    expect(detected.ci).toBe(false);
  });

  it('never reports ci for arbitrary non-numeric truthy strings', () => {
    const detected = detectCapabilities({ stdin: {}, env: { CI: 'yes' } });
    expect(detected.ci).toBe(false);
  });
});
