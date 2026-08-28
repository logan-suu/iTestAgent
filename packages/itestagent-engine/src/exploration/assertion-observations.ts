/**
 * Assertion observations — map exploration UI trees to AssertionEvaluator
 * observation facts (pure functions).
 *
 * The evaluator (assertion-evaluator.ts) checks conditions against
 * `Record<caseId, Record<factName, unknown>>` with the fact conventions
 * `${target}_visible` / `${target}_text` / `${target}_reached` and the
 * global `crashDetected`. This module builds those facts from the raw UI
 * tree XML captured during exploration.
 */
import type { UserAssertion } from 'itestagent-contracts';

/** One captured UI tree, keyed by the test case it belongs to. */
export interface UiTreeCapture {
  readonly caseId: string;
  readonly raw: string;
}

/** Whether the tree contains the target as an accessible name or label. */
export function elementVisibleInTree(raw: string, target: string): boolean {
  if (raw.length === 0) return false;
  return (
    raw.includes(`name="${target}"`) ||
    raw.includes(`label="${target}"`) ||
    raw.includes(`value="${target}"`)
  );
}

/**
 * Build evaluator observations from captured UI trees.
 *
 * - element_visible: true when the target appears as name/label/value in the
 *   case's tree, false when a tree exists but the target does not appear.
 * - no_crash: `crashDetected: false` — a captured tree from a completed
 *   exploration is itself evidence that no crash interrupted the run.
 * - custom conditions: no fact is emitted (evaluator marks them unchecked
 *   with "requires human evaluation").
 */
export function observationsFromUiTrees(
  assertions: readonly UserAssertion[],
  uiTrees: readonly UiTreeCapture[],
): Record<string, Record<string, unknown>> {
  const observations: Record<string, Record<string, unknown>> = {};

  for (const assertion of assertions) {
    const tree = uiTrees.find((t) => t.caseId === assertion.caseId);
    if (!tree) continue; // No tree for this case — evaluator marks conditions unchecked.

    const facts: Record<string, unknown> = {};
    for (const condition of assertion.conditions) {
      if (condition.type === 'no_crash') {
        facts.crashDetected = false;
        continue;
      }
      if (!condition.target) continue; // no_crash is the only target-less kind
      const key = `${condition.target}_visible`;
      facts[key] = elementVisibleInTree(tree.raw, condition.target);
    }

    if (Object.keys(facts).length > 0) {
      observations[assertion.caseId] = facts;
    }
  }

  return observations;
}
