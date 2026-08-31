/**
 * Centralized key→action registry for TUI review panels.
 *
 * B27: extracted from the inline switch statements that
 * src/renderers/opentui-renderer.tsx previously carried inside
 * CandidateReviewPanel and PlanReviewPanel. The tables map raw key strings to
 * exact TuiShellEvent payloads; src/renderers/opentui-key-dispatch.ts applies
 * them (including edit-mode handling).
 *
 * Enter submits the reviewed candidates or confirms the reviewed plan.
 */

import type { TuiShellEvent } from './tui-shell.js';

/** Key pressed in candidate review (non-edit mode) → dispatched event. */
export const CANDIDATE_REVIEW_KEYMAP: Readonly<Record<string, TuiShellEvent>> = {
  j: { type: 'candidate_navigate', direction: 'down' },
  k: { type: 'candidate_navigate', direction: 'up' },
  ' ': { type: 'candidate_toggle' },
  e: { type: 'candidate_edit_start' },
  A: { type: 'candidate_confirm_all' },
  N: { type: 'candidate_unconfirm_all' },
  enter: { type: 'candidate_confirm' },
  q: { type: 'exit_candidate_review' },
};

/** Key pressed in plan review (non-modify mode) → dispatched event. */
export const PLAN_REVIEW_KEYMAP: Readonly<Record<string, TuiShellEvent>> = {
  j: { type: 'plan_navigate_section', direction: 'down' },
  k: { type: 'plan_navigate_section', direction: 'up' },
  m: { type: 'plan_start_modify' },
  enter: { type: 'plan_confirm' },
  q: { type: 'plan_cancel' },
};

/** Shared edit-mode commit/cancel keys (candidate edit + plan modify). */
export const EDIT_COMMIT_KEY = 'enter';
export const EDIT_CANCEL_KEY = 'escape';

/** Look up the event bound to a normalized key, if any. */
export function lookupKeyAction(
  map: Readonly<Record<string, TuiShellEvent>>,
  key: string,
): TuiShellEvent | undefined {
  return map[key];
}
