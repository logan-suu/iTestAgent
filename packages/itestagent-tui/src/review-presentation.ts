import { formatAssertionSuggestions } from './assertion-review.js';
import { deviceReviewLines } from './device-review.js';
import { formatPlanSections } from './plan-review.js';
import {
  CANDIDATE_REVIEW_FOOTER_HINTS,
  PLAN_REVIEW_FOOTER_HINTS,
} from './renderers/opentui-footer.js';
import type { TuiShellState } from './tui-shell.js';

/** Text renderers keep the selected row and commands visible without printing the whole feed. */
export function reviewPresentation(state: TuiShellState, height: number): string[] {
  let title = '';
  let hint = '';
  let body: string[] = [];
  if (state.mode === 'device_review') {
    const lines = deviceReviewLines(state);
    title = lines[0] ?? '';
    hint = lines.at(-1) ?? '';
    body = lines.slice(1, -1);
  } else if (state.mode === 'candidate_review') {
    title = '[Candidate Review]';
    hint = CANDIDATE_REVIEW_FOOTER_HINTS;
    body = state.candidates.flatMap((candidate, index) => [
      `${index === state.candidateIndex ? '>' : ' '} [${candidate.confirmed ? 'x' : ' '}] ${candidate.name}`,
      `    ${candidate.evidence.join('; ')}`,
    ]);
  } else if (state.mode === 'plan_review') {
    title = '[Plan Review]';
    hint = PLAN_REVIEW_FOOTER_HINTS;
    body = state.plan
      ? formatPlanSections(state.plan).flatMap((section, index) => [
          `${index === state.planSectionIndex ? '>' : ' '} ${section.title}`,
          ...section.fields.map((field) => `    ${field.label}: ${field.value}`),
        ])
      : [];
  } else if (state.mode === 'assertion_review') {
    title = '[Assertion Review]';
    hint = '↑/↓ or j/k:nav Space:confirm n:reject A:all Enter:done Esc/q:back';
    body = formatAssertionSuggestions(state.assertionSuggestions, state.assertionIndex);
  }
  const selected = Math.max(
    0,
    body.findIndex((line) => line.startsWith('>')),
  );
  const budget = Math.max(3, height - 12);
  const start = Math.max(0, Math.min(selected - Math.floor(budget / 2), body.length - budget));
  const editing = state.candidateEditMode || state.planModifyMode;
  return [
    title,
    ...(state.messages.at(-1)?.type === 'error' ? [state.messages.at(-1)?.text ?? ''] : []),
    ...body.slice(start, start + budget),
    ...(start || body.length > budget
      ? [`Rows ${start + 1}-${Math.min(body.length, start + budget)}/${body.length}`]
      : []),
    editing ? 'Editing: ←/→ cursor, Enter:save, Esc:cancel' : hint,
  ];
}
