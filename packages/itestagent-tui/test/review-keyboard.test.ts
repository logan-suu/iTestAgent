import { describe, expect, test } from 'bun:test';
import { createAnsiInputHandler } from '../src/ansi-input.js';
import { createAnsiReviewInput } from '../src/renderers/ansi-review-input.js';
import { dispatchReviewKey } from '../src/renderers/opentui-key-dispatch.js';
import { reviewPresentation } from '../src/review-presentation.js';
import { type TuiShellEvent, createInitialState } from '../src/tui-shell.js';

describe('shared list keyboard routing', () => {
  for (const [mode, prefix, confirmation, cancellation] of [
    ['candidate_review', 'candidate', 'candidate_confirm', 'exit_candidate_review'],
    ['plan_review', 'plan', 'plan_confirm', 'plan_cancel'],
    ['device_review', 'device', 'device_confirm', 'device_cancel'],
    ['assertion_review', 'assertion', 'exit_assertion_review', 'exit_assertion_review'],
  ] as const) {
    test(`${mode} separates navigation from confirmation`, () => {
      const state = { ...createInitialState('/tmp'), mode };
      const events: TuiShellEvent[] = [];
      for (const key of ['down', 'up', 'enter', 'escape']) {
        expect(dispatchReviewKey(state, key, (event) => events.push(event))).toBe('handled');
      }
      expect(events).toEqual([
        {
          type: prefix === 'plan' ? 'plan_navigate_section' : `${prefix}_navigate`,
          direction: 'down',
        },
        {
          type: prefix === 'plan' ? 'plan_navigate_section' : `${prefix}_navigate`,
          direction: 'up',
        },
        { type: confirmation },
        { type: cancellation },
      ]);
    });
  }

  test('editing leaves cursor keys and text to the focused editor', () => {
    const events: TuiShellEvent[] = [];
    const state = {
      ...createInitialState('/tmp'),
      mode: 'candidate_review' as const,
      candidateEditMode: true,
    };
    for (const key of ['up', 'down', 'left', 'right', 'A', 'j', '中文']) {
      expect(dispatchReviewKey(state, key, (event) => events.push(event))).toBe('ignored');
    }
    expect(events).toEqual([]);
    dispatchReviewKey(state, 'escape', (event) => events.push(event));
    expect(events).toEqual([{ type: 'candidate_edit_cancel' }]);
  });

  test('Enter repeats cannot approve a target-kind change', () => {
    const state = {
      ...createInitialState('/tmp'),
      mode: 'device_review' as const,
      deviceTargetSwitch: {
        token: 'fixture',
        udid: 'fixture',
        name: 'Simulator',
        from: 'physical' as const,
        to: 'simulator' as const,
      },
    };
    const events: TuiShellEvent[] = [];
    for (const key of ['enter', 'enter', 'down', 'up'])
      dispatchReviewKey(state, key, (event) => events.push(event));
    expect(events).toEqual([]);
    dispatchReviewKey(state, 'escape', (event) => events.push(event));
    expect(events).toEqual([{ type: 'device_target_switch_decision', allow: false }]);
  });

  test('Space toggles candidates but Enter only submits existing selections', () => {
    const state = { ...createInitialState('/tmp'), mode: 'candidate_review' as const };
    const events: TuiShellEvent[] = [];
    for (const key of [' ', 'enter']) dispatchReviewKey(state, key, (event) => events.push(event));
    expect(events).toEqual([{ type: 'candidate_toggle' }, { type: 'candidate_confirm' }]);
    expect(
      dispatchReviewKey(createInitialState('/tmp'), 'enter', () => {
        throw new Error('Unexpected dispatch');
      }),
    ).toBe('ignored');
  });

  test('ANSI decodes fragmented CSI and SS3 without letter shortcuts', async () => {
    const keys: string[] = [];
    const input = createAnsiReviewInput((key) => keys.push(key));
    input.handleChunk('\x1b[');
    input.handleChunk('A');
    input.handleChunk('\x1bOB');
    input.handleChunk('\r');
    expect(keys).toEqual(['up', 'down', 'return']);
    input.handleChunk('\x1b');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(keys.at(-1)).toBe('escape');
    input.dispose();
  });

  test('ANSI edit cursor inserts Unicode without navigating the list', () => {
    const input = createAnsiInputHandler({ write() {}, submit() {}, interrupt() {} });
    input.beginEdit('测试AB');
    input.handleEditKey('left', 'left');
    input.handleEditKey('', '中');
    expect(input.getInputBuffer()).toBe('测试A中B');
    input.handleEditKey('up', 'up');
    input.handleEditKey('backspace', '');
    expect(input.getInputBuffer()).toBe('测试AB');
  });

  test('text renderer keeps a long selected row and footer visible', () => {
    const state = {
      ...createInitialState('/tmp'),
      mode: 'candidate_review' as const,
      candidateIndex: 19,
      candidates: Array.from({ length: 20 }, (_, index) => ({
        name: `Row ${index}`,
        evidence: [],
        confidence: 1,
        confirmed: false,
        displayOrder: index,
      })),
    };
    const lines = reviewPresentation(state, 24);
    expect(lines.join('\n')).toContain('> [ ] Row 19');
    expect(lines.at(-1)).toContain('Enter:confirm');
    expect(lines.length).toBeLessThan(16);
  });
});
