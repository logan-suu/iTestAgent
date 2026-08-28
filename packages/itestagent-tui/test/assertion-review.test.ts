/**
 * Assertion review tests — US-11.1 AC4.
 *
 * AC4: "Agent 建议断言时展示依据并请用户确认"
 *   1. 展示依据 — suggestions render conditions + evidence lines;
 *   2. 请用户确认 — confirm/reject/confirm-all transforms promote accepted
 *      suggestions into `assertionConfirmed` (tier-3 agentConfirmed) and the
 *      panel exits once nothing is pending.
 */
import { describe, expect, it } from 'bun:test';
import type { UserAssertion } from 'itestagent-contracts';
import {
  clampAssertionIndex,
  confirmAllAssertions,
  confirmAssertionAtIndex,
  formatAssertionCondition,
  formatAssertionSuggestion,
  formatAssertionSuggestions,
  rejectAssertionAtIndex,
} from '../src/assertion-review.js';
import { createInitialState, tuiShellReducer } from '../src/tui-shell.js';

function makeSuggestion(id: string, evidence?: string[]): UserAssertion {
  return {
    id,
    caseId: 'login',
    label: `suggestion-${id}`,
    source: 'agent',
    conditions: [
      { type: 'element_visible', target: 'login_button', description: 'login button visible' },
      { type: 'no_crash', description: 'no crash during run' },
    ],
    ...(evidence ? { evidence } : {}),
  };
}

describe('formatAssertionCondition', () => {
  it('renders type:target → expected', () => {
    expect(
      formatAssertionCondition({
        type: 'element_visible',
        target: 'login_button',
        description: 'login button visible',
      }),
    ).toBe('element_visible:login_button');
  });

  it('renders expected values when present', () => {
    expect(
      formatAssertionCondition({
        type: 'element_text',
        target: 'header',
        expected: 'Welcome',
        description: 'header greets user',
      }),
    ).toBe('element_text:header → Welcome');
  });

  it('renders no_crash without a target', () => {
    expect(formatAssertionCondition({ type: 'no_crash', description: 'no crash during run' })).toBe(
      'no_crash:—',
    );
  });
});

describe('formatAssertionSuggestion (AC4: 展示依据)', () => {
  it('shows header, conditions and evidence lines', () => {
    const lines = formatAssertionSuggestion(
      makeSuggestion('s1', ['observed login_button visible in exploration']),
      true,
    );
    expect(lines[0] ?? '').toContain('> [agent] suggestion-s1 (login)');
    expect(lines.some((l) => l.includes('element_visible:login_button'))).toBe(true);
    expect(lines.some((l) => l.includes('no_crash:—'))).toBe(true);
    expect(lines.some((l) => l.includes('ev: observed login_button visible'))).toBe(true);
  });

  it('unselected suggestions use a space marker', () => {
    const lines = formatAssertionSuggestion(makeSuggestion('s1'), false);
    expect((lines[0] ?? '').startsWith('  ')).toBe(true);
  });

  it('formatAssertionSuggestions marks only the selected index', () => {
    const lines = formatAssertionSuggestions([makeSuggestion('s1'), makeSuggestion('s2')], 1);
    const marked = lines.filter((l) => l.trimStart().startsWith('>'));
    expect(marked).toHaveLength(1);
    expect(marked[0] ?? '').toContain('s2');
  });
});

describe('confirm/reject transforms (AC4: 请用户确认)', () => {
  it('confirmAssertionAtIndex promotes the selection to confirmed', () => {
    const suggestions = [makeSuggestion('s1'), makeSuggestion('s2')];
    const result = confirmAssertionAtIndex(suggestions, 0);
    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0]?.id).toBe('s1');
    expect(result.remaining.map((s) => s.id)).toEqual(['s2']);
  });

  it('confirmAssertionAtIndex is a no-op for an out-of-range index', () => {
    const suggestions = [makeSuggestion('s1')];
    const result = confirmAssertionAtIndex(suggestions, 5);
    expect(result.confirmed).toHaveLength(0);
    expect(result.remaining).toBe(suggestions);
  });

  it('rejectAssertionAtIndex discards without promoting', () => {
    const suggestions = [makeSuggestion('s1'), makeSuggestion('s2')];
    const result = rejectAssertionAtIndex(suggestions, 0);
    expect(result.confirmed).toHaveLength(0);
    expect(result.remaining.map((s) => s.id)).toEqual(['s2']);
  });

  it('confirmAllAssertions promotes everything and empties remaining', () => {
    const suggestions = [makeSuggestion('s1'), makeSuggestion('s2')];
    const result = confirmAllAssertions(suggestions);
    expect(result.remaining).toHaveLength(0);
    expect(result.confirmed).toHaveLength(2);
  });

  it('clampAssertionIndex bounds the cursor', () => {
    expect(clampAssertionIndex(-3, 2)).toBe(0);
    expect(clampAssertionIndex(9, 2)).toBe(1);
    expect(clampAssertionIndex(0, 0)).toBe(0);
  });
});

describe('assertion review reducer integration (US-11.1 AC4)', () => {
  it('enter_assertion_review switches mode and resets the review state', () => {
    const next = tuiShellReducer(createInitialState('/ws'), {
      type: 'enter_assertion_review',
      suggestions: [makeSuggestion('s1')],
    });
    expect(next.mode).toBe('assertion_review');
    expect(next.assertionSuggestions).toHaveLength(1);
    expect(next.assertionConfirmed).toHaveLength(0);
    expect(next.assertionIndex).toBe(0);
  });

  it('navigate clamps at both bounds', () => {
    let state = createInitialState('/ws');
    state = tuiShellReducer(state, {
      type: 'enter_assertion_review',
      suggestions: [makeSuggestion('s1'), makeSuggestion('s2')],
    });
    state = tuiShellReducer(state, { type: 'assertion_navigate', direction: 'down' });
    expect(state.assertionIndex).toBe(1);
    state = tuiShellReducer(state, { type: 'assertion_navigate', direction: 'down' });
    expect(state.assertionIndex).toBe(1);
    state = tuiShellReducer(state, { type: 'assertion_navigate', direction: 'up' });
    state = tuiShellReducer(state, { type: 'assertion_navigate', direction: 'up' });
    expect(state.assertionIndex).toBe(0);
  });

  it('confirm promotes to assertionConfirmed and exits with a notice on the last item', () => {
    let state = createInitialState('/ws');
    state = tuiShellReducer(state, {
      type: 'enter_assertion_review',
      suggestions: [makeSuggestion('s1'), makeSuggestion('s2')],
    });
    state = tuiShellReducer(state, { type: 'assertion_confirm' });
    expect(state.assertionConfirmed.map((s) => s.id)).toEqual(['s1']);
    expect(state.assertionSuggestions.map((s) => s.id)).toEqual(['s2']);
    expect(state.mode).toBe('assertion_review');

    state = tuiShellReducer(state, { type: 'assertion_confirm' });
    expect(state.mode).toBe('chat');
    expect(state.assertionConfirmed).toHaveLength(2);
    expect(
      state.messages.some((m) => m.text.includes('Promoted to tier-3 agent-confirmed assertions')),
    ).toBe(true);
  });

  it('reject discards the suggestion without promoting', () => {
    let state = createInitialState('/ws');
    state = tuiShellReducer(state, {
      type: 'enter_assertion_review',
      suggestions: [makeSuggestion('s1')],
    });
    state = tuiShellReducer(state, { type: 'assertion_reject' });
    expect(state.mode).toBe('chat');
    expect(state.assertionConfirmed).toHaveLength(0);
    expect(state.assertionSuggestions).toHaveLength(0);
  });

  it('confirm_all promotes everything in one action', () => {
    let state = createInitialState('/ws');
    state = tuiShellReducer(state, {
      type: 'enter_assertion_review',
      suggestions: [makeSuggestion('s1'), makeSuggestion('s2')],
    });
    state = tuiShellReducer(state, { type: 'assertion_confirm_all' });
    expect(state.mode).toBe('chat');
    expect(state.assertionConfirmed).toHaveLength(2);
    expect(state.assertionSuggestions).toHaveLength(0);
  });

  it('exit keeps confirmed assertions for the engine (tier-3 handoff)', () => {
    let state = createInitialState('/ws');
    state = tuiShellReducer(state, {
      type: 'enter_assertion_review',
      suggestions: [makeSuggestion('s1'), makeSuggestion('s2')],
    });
    state = tuiShellReducer(state, { type: 'assertion_confirm' });
    state = tuiShellReducer(state, { type: 'exit_assertion_review' });
    expect(state.mode).toBe('chat');
    expect(state.assertionConfirmed.map((s) => s.id)).toEqual(['s1']);
    expect(state.assertionSuggestions).toHaveLength(0);
  });
});
