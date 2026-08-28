/**
 * UI tree redaction — B08 new capability (promotion guide §6.1 "Flow replay
 * + UI tree redaction | 可复现与隐私保护"; §5.1 evidence line).
 *
 * Generic, product-neutral scrubbing of UiTree XML before it is persisted as
 * replay evidence: `value` attributes on elements whose tag/name/class/label
 * hints at sensitive input (password / secure / secret / otp / token) are
 * replaced with a fixed mask. Structure, element types and non-sensitive
 * attributes are preserved so the snapshot stays replay-debuggable.
 *
 * R6: this is defense-in-depth for evidence artifacts only — real secrets
 * must never enter flows in the first place (session.secret.* valueRefs).
 */

const SENSITIVE_ELEMENT_HINT = /(password|secure|secret|otp|token)/i;

const MASKED_VALUE = 'value="••••••"';

export interface UiTreeRedactionResult {
  /** Redacted XML (identical to the input when nothing matched). */
  xml: string;
  /** Number of value attributes that were masked. */
  redactionCount: number;
}

/**
 * Masks `value="..."` attributes on sensitive-looking elements.
 * Non-sensitive elements pass through byte-for-byte unchanged.
 */
export function redactUiTreeXml(xml: string): UiTreeRedactionResult {
  let redactionCount = 0;
  const out = xml.replace(/<\w+[^>]*>/g, (tag) => {
    if (!SENSITIVE_ELEMENT_HINT.test(tag)) return tag;
    return tag.replace(/\bvalue="[^"]*"/g, () => {
      redactionCount++;
      return MASKED_VALUE;
    });
  });
  return { xml: out, redactionCount };
}
