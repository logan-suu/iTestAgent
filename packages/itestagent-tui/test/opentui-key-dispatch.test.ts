/**
 * Tests for src/keymap-registry.ts + src/renderers/opentui-key-dispatch.ts.
 *
 * B27 extracts the key→action tables and the panel command handlers from
 * src/renderers/opentui-renderer.tsx (CandidateReviewPanel / PlanReviewPanel)
 * into framework-independent modules. These tests lock the EXACT dispatch
 * behavior the panels previously implemented inline:
 *
 *   - value normalization: `value === ' ' ? ' ' : value.trim()`, empty → ignore
 *   - candidate keys: j/k/space/e/A/N/q (+ edit-mode enter/escape/chars)
 *   - plan keys: j/k/m/enter/q (+ modify-mode enter/escape/chars)
 *   - edit input replays one `*_edit_input` event PER CHARACTER, each carrying
 *     the draft accumulated so far (the legacy panels re-read the live Solid
 *     signal between characters while the reducer appended)
 */

import { describe, expect, it } from 'bun:test';
import {
  CANDIDATE_REVIEW_KEYMAP,
  EDIT_CANCEL_KEY,
  EDIT_COMMIT_KEY,
  PLAN_REVIEW_KEYMAP,
  lookupKeyAction,
} from '../src/keymap-registry.js';
import {
  type KeyDispatchContext,
  dispatchCandidateKey,
  dispatchPlanKey,
} from '../src/renderers/opentui-key-dispatch.js';
import type { TuiShellEvent } from '../src/tui-shell.js';

// ── harness ───────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<KeyDispatchContext> = {}): {
  ctx: KeyDispatchContext;
  events: TuiShellEvent[];
} {
  const events: TuiShellEvent[] = [];
  const ctx: KeyDispatchContext = {
    dispatch: (event) => events.push(event),
    editMode: false,
    editDraft: '',
    ...overrides,
  };
  return { ctx, events };
}

// ── registry data ─────────────────────────────────────────────────────

describe('keymap-registry', () => {
  it('maps the candidate review keys to their exact events', () => {
    expect(CANDIDATE_REVIEW_KEYMAP.j).toEqual({ type: 'candidate_navigate', direction: 'down' });
    expect(CANDIDATE_REVIEW_KEYMAP.k).toEqual({ type: 'candidate_navigate', direction: 'up' });
    expect(CANDIDATE_REVIEW_KEYMAP[' ']).toEqual({ type: 'candidate_toggle' });
    expect(CANDIDATE_REVIEW_KEYMAP.e).toEqual({ type: 'candidate_edit_start' });
    expect(CANDIDATE_REVIEW_KEYMAP.A).toEqual({ type: 'candidate_confirm_all' });
    expect(CANDIDATE_REVIEW_KEYMAP.N).toEqual({ type: 'candidate_unconfirm_all' });
    expect(CANDIDATE_REVIEW_KEYMAP.q).toEqual({ type: 'exit_candidate_review' });
  });

  it('does NOT bind Enter in non-edit candidate mode (falls through unhandled)', () => {
    expect(CANDIDATE_REVIEW_KEYMAP.enter).toBeUndefined();
  });

  it('maps the plan review keys to their exact events', () => {
    expect(PLAN_REVIEW_KEYMAP.j).toEqual({
      type: 'plan_navigate_section',
      direction: 'down',
    });
    expect(PLAN_REVIEW_KEYMAP.k).toEqual({ type: 'plan_navigate_section', direction: 'up' });
    expect(PLAN_REVIEW_KEYMAP.m).toEqual({ type: 'plan_start_modify' });
    expect(PLAN_REVIEW_KEYMAP.enter).toEqual({ type: 'plan_confirm' });
    expect(PLAN_REVIEW_KEYMAP.q).toEqual({ type: 'plan_cancel' });
  });

  it('declares enter/escape as the shared edit commit/cancel keys', () => {
    expect(EDIT_COMMIT_KEY).toBe('enter');
    expect(EDIT_CANCEL_KEY).toBe('escape');
  });

  it('lookupKeyAction returns undefined for unknown keys', () => {
    expect(lookupKeyAction(CANDIDATE_REVIEW_KEYMAP, 'z')).toBeUndefined();
    expect(lookupKeyAction(PLAN_REVIEW_KEYMAP, ' ')).toBeUndefined();
  });
});

// ── candidate dispatch ────────────────────────────────────────────────

describe('dispatchCandidateKey — review mode', () => {
  it('dispatches navigation, toggle, edit-start, confirm-all, unconfirm-all and exit', () => {
    for (const key of ['j', 'k', ' ', 'e', 'A', 'N', 'q'] as const) {
      const { ctx, events } = makeCtx();
      const result = dispatchCandidateKey(ctx, key);
      expect(result).toBe('handled');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(lookupKeyAction(CANDIDATE_REVIEW_KEYMAP, key));
    }
  });

  it('ignores unknown keys without dispatching', () => {
    const { ctx, events } = makeCtx();
    expect(dispatchCandidateKey(ctx, 'z')).toBe('ignored');
    expect(events).toHaveLength(0);
  });

  it('ignores empty values', () => {
    const { ctx, events } = makeCtx();
    expect(dispatchCandidateKey(ctx, '')).toBe('ignored');
    expect(events).toHaveLength(0);
  });

  it('preserves a literal space value but trims other whitespace', () => {
    // ' ' must survive trimming (toggle), while ' j ' resolves to 'j'.
    const space = makeCtx();
    dispatchCandidateKey(space.ctx, ' ');
    expect(space.events[0]?.type).toBe('candidate_toggle');

    const padded = makeCtx();
    dispatchCandidateKey(padded.ctx, ' j ');
    expect(padded.events[0]).toEqual({ type: 'candidate_navigate', direction: 'down' });
  });
});

describe('dispatchCandidateKey — edit mode', () => {
  const editCtx = (draft: string) => makeCtx({ editMode: true, editDraft: draft });

  it('commits on Enter and reports edit-committed', () => {
    const { ctx, events } = editCtx('Login button');
    expect(dispatchCandidateKey(ctx, 'enter')).toBe('edit-committed');
    expect(events).toEqual([{ type: 'candidate_edit_commit' }]);
  });

  it('cancels on Escape', () => {
    const { ctx, events } = editCtx('partial');
    expect(dispatchCandidateKey(ctx, 'escape')).toBe('handled');
    expect(events).toEqual([{ type: 'candidate_edit_cancel' }]);
  });

  it('replays regular characters one event per character with accumulated drafts', () => {
    const { ctx, events } = editCtx('Log');
    const result = dispatchCandidateKey(ctx, 'in');
    expect(result).toBe('handled');
    expect(events).toEqual([
      { type: 'candidate_edit_input', text: 'Logi' },
      { type: 'candidate_edit_input', text: 'Login' },
    ]);
  });

  it('treats Enter/Escape words atomically (no per-character replay)', () => {
    const { ctx, events } = editCtx('');
    dispatchCandidateKey(ctx, 'escape');
    expect(events).toEqual([{ type: 'candidate_edit_cancel' }]);
  });
});

// ── plan dispatch ─────────────────────────────────────────────────────

describe('dispatchPlanKey — review mode', () => {
  it('dispatches section navigation, modify start, confirm and cancel', () => {
    for (const key of ['j', 'k', 'm', 'enter', 'q'] as const) {
      const { ctx, events } = makeCtx();
      const result = dispatchPlanKey(ctx, key);
      expect(result).toBe('handled');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(lookupKeyAction(PLAN_REVIEW_KEYMAP, key));
    }
  });

  it('ignores unknown keys such as space or e', () => {
    const { ctx, events } = makeCtx();
    expect(dispatchPlanKey(ctx, ' ')).toBe('ignored');
    expect(dispatchPlanKey(ctx, 'e')).toBe('ignored');
    expect(events).toHaveLength(0);
  });
});

describe('dispatchPlanKey — modify mode', () => {
  const modifyCtx = (draft: string) => makeCtx({ editMode: true, editDraft: draft });

  it('submits modification on Enter', () => {
    const { ctx, events } = modifyCtx('add retry');
    expect(dispatchPlanKey(ctx, 'enter')).toBe('edit-committed');
    expect(events).toEqual([{ type: 'plan_modify_submit' }]);
  });

  it('cancels modification on Escape', () => {
    const { ctx, events } = modifyCtx('add retry');
    expect(dispatchPlanKey(ctx, 'escape')).toBe('handled');
    expect(events).toEqual([{ type: 'plan_modify_cancel' }]);
  });

  it('replays modification text one event per character', () => {
    const { ctx, events } = modifyCtx('re');
    dispatchPlanKey(ctx, 'try');
    expect(events).toEqual([
      { type: 'plan_modify_input', text: 'ret' },
      { type: 'plan_modify_input', text: 'retr' },
      { type: 'plan_modify_input', text: 'retry' },
    ]);
  });
});
