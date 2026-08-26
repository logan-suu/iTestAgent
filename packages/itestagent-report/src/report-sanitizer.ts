/**
 * Report text sanitization — B09 module split (promotion guide §11.3 "report
 * validation", §6.1 "report sanitization"; R6).
 *
 * Before any report text is written, default rules scrub Apple UDID-shaped
 * identifiers and absolute home paths so raw device identity and machine
 * paths never land in summary.md / result.json.
 */

export interface ReportRedactionRule {
  /** Stable name used for diagnostics/auditing. */
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** Default rules applied when no custom set is supplied. */
export const REPORT_REDACTION_RULES = [
  {
    name: 'apple_udid',
    pattern: /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}\b/g,
    replacement: '[REDACTED-UDID]',
  },
  {
    name: 'home_path',
    pattern: /(?:\/Users\/|\/home\/)[^\s"']+/g,
    replacement: '[REDACTED-PATH]',
  },
] as const satisfies readonly ReportRedactionRule[];

export interface ReportSanitizeResult {
  /** Redacted text (unchanged when nothing matched). */
  text: string;
  /** Total number of redactions applied across all rules. */
  redactions: number;
}

/** Applies every rule in order, counting each replacement. */
export function sanitizeReportText(
  text: string,
  rules: readonly ReportRedactionRule[] = REPORT_REDACTION_RULES,
): ReportSanitizeResult {
  let redactions = 0;
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.pattern, () => {
      redactions++;
      return rule.replacement;
    });
  }
  return { text: out, redactions };
}
