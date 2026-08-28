/**
 * Assertion review — pure transforms for the US-11.1 AC4 confirmation flow.
 *
 * AC4: "Agent 建议断言时展示依据并请用户确认" — agent-suggested assertions
 * (tier 3, unconfirmed) must be presented WITH their evidence and only become
 * usable tier-3 assertions (`agentConfirmed`) after explicit user confirmation.
 *
 * This module is framework-independent (same layer as candidate-review.ts /
 * plan-review.ts); the OpenTUI/Ink renderers only project its output.
 */
import type { UserAssertion } from 'itestagent-contracts';

// ─── Evidence formatting (AC4: 展示依据) ────────────────────────────────

/** Formats a single assertion condition as `type:target → expected`. */
export function formatAssertionCondition(condition: UserAssertion['conditions'][number]): string {
  const target = condition.target ? `${condition.target}` : '—';
  const expected = condition.expected != null ? String(condition.expected) : '';
  return `${condition.type}:${target}${expected ? ` → ${expected}` : ''}`;
}

/**
 * Formats one agent-suggested assertion as display lines.
 *
 * Line 1: selection marker + label/caseId header.
 * Following lines: each condition, then evidence entries (AC4 依据).
 */
export function formatAssertionSuggestion(
  suggestion: UserAssertion,
  isSelected: boolean,
): string[] {
  const prefix = isSelected ? '>' : ' ';
  const header = suggestion.label ?? suggestion.caseId;
  const lines: string[] = [`${prefix} [${suggestion.source}] ${header} (${suggestion.caseId})`];

  for (const condition of suggestion.conditions) {
    lines.push(`    · ${formatAssertionCondition(condition)}`);
  }

  for (const evidence of suggestion.evidence ?? []) {
    lines.push(`    ⌕ ev: ${evidence}`);
  }

  return lines;
}

/** Formats all suggestions for panel rendering. */
export function formatAssertionSuggestions(
  suggestions: readonly UserAssertion[],
  selectedIndex: number,
): string[] {
  const lines: string[] = [];
  suggestions.forEach((suggestion, index) => {
    lines.push(...formatAssertionSuggestion(suggestion, index === selectedIndex));
  });
  return lines;
}

/** Footer status line: confirmed vs remaining counts. */
export function assertionFooterStatus(confirmed: number, total: number): string {
  if (total === 0) return 'No agent-suggested assertions.';
  return `${confirmed}/${total} confirmed — space:confirm n:reject A:confirm-all q:done`;
}

// ─── Confirm / reject transforms (AC4: 请用户确认) ──────────────────────

/** Result of a single confirm/reject action. */
export interface AssertionReviewTransform {
  readonly remaining: readonly UserAssertion[];
  readonly confirmed: readonly UserAssertion[];
}

/** Confirms the suggestion at `index`, promoting it to tier-3 `agentConfirmed`. */
export function confirmAssertionAtIndex(
  suggestions: readonly UserAssertion[],
  index: number,
): AssertionReviewTransform {
  const target = suggestions[index];
  if (!target) {
    return { remaining: suggestions, confirmed: [] };
  }
  return {
    remaining: suggestions.filter((_, i) => i !== index),
    confirmed: [target],
  };
}

/** Rejects the suggestion at `index` (it is discarded, never used as tier 3). */
export function rejectAssertionAtIndex(
  suggestions: readonly UserAssertion[],
  index: number,
): AssertionReviewTransform {
  const target = suggestions[index];
  if (!target) {
    return { remaining: suggestions, confirmed: [] };
  }
  return {
    remaining: suggestions.filter((_, i) => i !== index),
    confirmed: [],
  };
}

/** Confirms every remaining suggestion at once. */
export function confirmAllAssertions(
  suggestions: readonly UserAssertion[],
): AssertionReviewTransform {
  return { remaining: [], confirmed: [...suggestions] };
}

/** Clamps the selection index into the valid range for the panel. */
export function clampAssertionIndex(index: number, total: number): number {
  if (total === 0) return 0;
  if (index < 0) return 0;
  if (index >= total) return total - 1;
  return index;
}

/** Footer key hints shown at the top of the assertion review panel. */
export const ASSERTION_REVIEW_FOOTER_HINTS =
  'j/k: navigate · space: confirm · n: reject · A: confirm all · q: done';
