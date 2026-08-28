/**
 * Assertion observations — map exploration UI trees to AssertionEvaluator
 * observation facts (pure functions).
 *
 * The evaluator (assertion-evaluator.ts) checks conditions against
 * `Record<caseId, Record<factName, unknown>>` with the fact conventions
 * `${target}_visible` / `${target}_text` (string) / `${target}_enabled` /
 * `${target}_reached` and the global `crashDetected`. This module builds
 * those facts from the raw UI tree XML captured during exploration.
 */
import type { UserAssertion } from 'itestagent-contracts';

/** One captured UI tree, keyed by the test case it belongs to. */
export interface UiTreeCapture {
  readonly caseId: string;
  readonly raw: string;
}

/** Escape for literal matching inside XML attribute values (& first). */
function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Decode XML attribute entities (&amp; last so double escapes resolve). */
function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** Both the raw and the XML-escaped form of `target`. */
function attributeVariants(target: string): string[] {
  const escaped = escapeXmlAttribute(target);
  return escaped === target ? [target] : [target, escaped];
}

/** Read one attribute value from a serialized attribute string. */
function extractAttrValue(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXmlAttribute(match[1] ?? '') : null;
}

/**
 * Attributes of the first XCUIElement node whose name/label/value matches
 * the target, or null when no node matches. WDA serializes each element as
 * `<XCUIElementTypeX ... name="..." label="..." value="..." ...>`; the
 * entity-escaped variant is matched too, so targets containing `&`, `<`,
 * `>`, `"` or `'` still resolve.
 */
export function findElementNodeAttrs(raw: string, target: string): string | null {
  if (raw.length === 0) return null;
  const variants = attributeVariants(target);
  const nodeRe = /<XCUIElementType[A-Za-z]+\b([^>]*)>/g;
  for (const match of raw.matchAll(nodeRe)) {
    const attrs = match[1] ?? '';
    for (const variant of variants) {
      if (
        attrs.includes(`name="${variant}"`) ||
        attrs.includes(`label="${variant}"`) ||
        attrs.includes(`value="${variant}"`)
      ) {
        return attrs;
      }
    }
  }
  return null;
}

/** Whether the tree contains the target as an accessible name or label. */
export function elementVisibleInTree(raw: string, target: string): boolean {
  return findElementNodeAttrs(raw, target) !== null;
}

/**
 * Build evaluator observations from captured UI trees.
 *
 * - element_visible → `${target}_visible` boolean (false when the tree
 *   exists but the target does not appear)
 * - element_text → `${target}_text` string: the matched node's value/label
 *   text (key skipped when the element is absent, so the evaluator marks
 *   the condition unchecked instead of matching against an empty string)
 * - element_disabled → `${target}_enabled` boolean from the node's
 *   `enabled` attribute (key skipped when the element is absent)
 * - navigation_reached → `${target}_reached` boolean: screen-heuristic on
 *   the target appearing in the captured tree
 * - no_crash → `crashDetected: false` — a captured tree from a completed
 *   exploration is itself evidence that no crash interrupted the run
 * - custom conditions: no fact is emitted (evaluator marks them unchecked
 *   with "requires human evaluation")
 */
export function observationsFromUiTrees(
  assertions: readonly UserAssertion[],
  uiTrees: readonly UiTreeCapture[],
): Record<string, Record<string, unknown>> {
  const observations: Record<string, Record<string, unknown>> = {};

  for (const assertion of assertions) {
    const tree = uiTrees.find((t) => t.caseId === assertion.caseId);
    if (!tree) continue; // No tree for this case — evaluator marks conditions unchecked.

    // Accumulate per caseId: multiple assertions may share one case and
    // later assertions must not erase earlier facts.
    const existing = observations[assertion.caseId];
    const facts = existing ?? {};
    observations[assertion.caseId] = facts;

    for (const condition of assertion.conditions) {
      if (condition.type === 'no_crash') {
        facts.crashDetected = false;
        continue;
      }
      if (!condition.target) continue; // no_crash is the only target-less kind

      const nodeAttrs = findElementNodeAttrs(tree.raw, condition.target);
      const target = condition.target;
      switch (condition.type) {
        case 'element_visible':
          facts[`${target}_visible`] = nodeAttrs !== null;
          break;
        case 'element_text': {
          if (nodeAttrs === null) break;
          // Empty-string attributes (value="") are common in XCUITest XML —
          // fall through to the next attribute instead of losing the text.
          facts[`${target}_text`] =
            extractAttrValue(nodeAttrs, 'value') ||
            extractAttrValue(nodeAttrs, 'label') ||
            extractAttrValue(nodeAttrs, 'name') ||
            '';
          break;
        }
        case 'element_disabled': {
          if (nodeAttrs === null) break;
          facts[`${target}_enabled`] = extractAttrValue(nodeAttrs, 'enabled') !== 'false';
          break;
        }
        case 'navigation_reached':
          facts[`${target}_reached`] = nodeAttrs !== null;
          break;
        default:
          break; // custom — human judgment, no fact emitted
      }
    }

    if (Object.keys(facts).length === 0) delete observations[assertion.caseId];
  }

  return observations;
}
