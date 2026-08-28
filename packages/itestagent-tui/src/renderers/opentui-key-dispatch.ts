/**
 * Key dispatch for the OpenTUI review panels.
 *
 * B27: extracted from the inline handleCommand closures in
 * src/renderers/opentui-renderer.tsx (CandidateReviewPanel / PlanReviewPanel).
 * Behavior is byte-for-byte the same as the pre-refactor panels:
 *
 *   - empty values are ignored
 *   - a literal ' ' survives; any other value is trimmed
 *   - edit/modify mode: Enter commits, Escape cancels, anything else replays
 *     one `*_edit_input` event PER CHARACTER carrying the draft accumulated
 *     so far (the legacy panels re-read the live Solid signal between chars,
 *     which the reducer kept appending to)
 *   - review mode: keymap lookup, unknown keys ignored
 */

import {
  CANDIDATE_REVIEW_KEYMAP,
  EDIT_CANCEL_KEY,
  EDIT_COMMIT_KEY,
  PLAN_REVIEW_KEYMAP,
  lookupKeyAction,
} from '../keymap-registry.js';
import type { TuiShellEvent } from '../tui-shell.js';

/** Outcome of one dispatched key, mirroring the legacy panel side effects. */
export type KeyDispatchResult = 'handled' | 'edit-committed' | 'ignored';

/** Ports the dispatcher needs: event sink plus current edit-mode context. */
export interface KeyDispatchContext {
  dispatch(event: TuiShellEvent): void;
  /** Whether the panel is in candidate-edit / plan-modify mode. */
  editMode: boolean;
  /** Draft text at dispatch time (candidateEditDraft / planModifyDraft). */
  editDraft: string;
}

/** Normalize a raw input value the way the legacy panels did. */
function normalizeKey(value: string): string | null {
  if (!value) return null;
  const key = value === ' ' ? ' ' : value.trim();
  if (!key) return null;
  return key;
}

/**
 * Handle one command value for CandidateReviewPanel. Returns 'edit-committed'
 * so the panel can clear its command signal synchronously on commit.
 */
export function dispatchCandidateKey(ctx: KeyDispatchContext, value: string): KeyDispatchResult {
  const key = normalizeKey(value);
  if (!key) return 'ignored';

  if (ctx.editMode) {
    if (key === EDIT_COMMIT_KEY) {
      ctx.dispatch({ type: 'candidate_edit_commit' });
      return 'edit-committed';
    }
    if (key === EDIT_CANCEL_KEY) {
      ctx.dispatch({ type: 'candidate_edit_cancel' });
      return 'handled';
    }
    let draft = ctx.editDraft;
    for (const ch of key) {
      draft += ch;
      ctx.dispatch({ type: 'candidate_edit_input', text: draft });
    }
    return 'handled';
  }

  const event = lookupKeyAction(CANDIDATE_REVIEW_KEYMAP, key);
  if (!event) return 'ignored';
  ctx.dispatch(event);
  return 'handled';
}

/** Handle one command value for PlanReviewPanel. */
export function dispatchPlanKey(ctx: KeyDispatchContext, value: string): KeyDispatchResult {
  const key = normalizeKey(value);
  if (!key) return 'ignored';

  if (ctx.editMode) {
    if (key === EDIT_COMMIT_KEY) {
      ctx.dispatch({ type: 'plan_modify_submit' });
      return 'edit-committed';
    }
    if (key === EDIT_CANCEL_KEY) {
      ctx.dispatch({ type: 'plan_modify_cancel' });
      return 'handled';
    }
    let draft = ctx.editDraft;
    for (const ch of key) {
      draft += ch;
      ctx.dispatch({ type: 'plan_modify_input', text: draft });
    }
    return 'handled';
  }

  const event = lookupKeyAction(PLAN_REVIEW_KEYMAP, key);
  if (!event) return 'ignored';
  ctx.dispatch(event);
  return 'handled';
}
