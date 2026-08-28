/**
 * Footer constants and status-line builders for the OpenTUI review panels.
 *
 * B27: extracted from src/renderers/opentui-renderer.tsx so the hint strings
 * live in one place (they are part of the panel UX contract exercised by the
 * shell tests). Strings must stay byte-identical to the pre-refactor panels.
 */

/** Key hints shown in the candidate review footer. */
export const CANDIDATE_REVIEW_FOOTER_HINTS = 'j/k:nav space:toggle e:edit A:all N:none q:done';

/** Key hints shown in the plan review footer. */
export const PLAN_REVIEW_FOOTER_HINTS = 'j/k:nav m:modify Enter:start q:cancel';

/** Label prefixing the command input in both review footers. */
export const FOOTER_CMD_LABEL = 'Cmd: ';

/** Hint shown while a candidate name is being edited. */
export const CANDIDATE_EDITING_HINT = 'Editing — type name, then Enter to save. Escape to cancel ';

/** Hint shown while a plan section is being modified. */
export const PLAN_MODIFYING_HINT =
  'Describe changes in natural language, then Enter to submit. Escape to cancel ';

/** "n/total confirmed" counter for the candidate review footer. */
export function candidateFooterStatus(confirmedCount: number, total: number): string {
  return `${confirmedCount}/${total} confirmed  `;
}

/** "Section i/total" counter for the plan review footer (1-based index). */
export function planFooterStatus(sectionIndex: number, total: number): string {
  return `Section ${sectionIndex + 1}/${total}  `;
}
