/**
 * redact-secrets.ts — secret redaction helper (G7 / R6). Replaces well-known
 * secret shapes in free-form text (log lines, error messages, reports) with a
 * mask so the raw secret value never echoes into output.
 *
 * Contract (tests/security/no-secret-echo.test.ts):
 *   export interface RedactOptions {
 *     patterns?: RegExp[];  // Extra patterns beyond the built-in defaults.
 *     mask?: string;        // Replacement; defaults to '[REDACTED]'.
 *   }
 *   export function redact(input: string, options?: RedactOptions): string;
 *
 * Built-in defaults cover: OpenAI-style `sk-` keys, AWS `AKIA` access keys,
 * JWT bearer tokens, `Bearer <token>` headers, and generic key=value
 * credential assignments (`api_key=`, `password=`, `secret=`, `token=`).
 */

/** Options controlling how redaction behaves. */
export interface RedactOptions {
  /** Extra patterns beyond the built-in defaults. */
  patterns?: RegExp[];
  /** Replacement string; defaults to '[REDACTED]'. */
  mask?: string;
}

const DEFAULT_MASK = '[REDACTED]';

// Built-in secret-shape patterns. Values are described as character classes
// (never as literal secrets) so the source stays G7-clean for gitleaks.
const DEFAULT_PATTERNS: RegExp[] = [
  // OpenAI-style API keys: `sk-` or `sk-proj-` followed by a long token body.
  /(?:sk|sk-proj)-[A-Za-z0-9_-]{16,}/g,
  // AWS access key IDs: `AKIA` plus exactly 16 uppercase alphanumerics.
  /\bAKIA[A-Z0-9]{16}\b/g,
  // JWT bearer tokens: three base64url segments, header starts with `eyJ`.
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  // `Bearer <token>` header values.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gi,
  // Generic key=value / key:value credential assignments.
  /(?:api[_-]?key|password|passwd|secret|token|access[_-]?key)\s*[:=]\s*[^\s"'&,;]+/gi,
];

/** Ensures a pattern has the global flag so replace covers every match. */
function asGlobal(pattern: RegExp): RegExp {
  return pattern.global
    ? pattern
    : new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

/**
 * Replaces every well-known secret shape in `input` with the mask so the raw
 * value never appears in output.
 */
export function redact(input: string, options?: RedactOptions): string {
  const mask = options?.mask ?? DEFAULT_MASK;
  const patterns = [...DEFAULT_PATTERNS, ...(options?.patterns ?? [])].map(asGlobal);

  let output = input;
  for (const pattern of patterns) {
    output = output.replace(pattern, () => mask);
  }
  return output;
}
