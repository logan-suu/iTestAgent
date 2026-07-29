/**
 * Redactor — strips sensitive identifiers from error messages and logs (R6, Gate 6).
 *
 * Removes or replaces: email addresses, UDIDs, Team IDs, device names,
 * user home directory paths, IP addresses, and other PII from strings.
 *
 * All AppiumDeviceBackend error paths should route through this redactor.
 *
 * R6: Sensitive data (account/UDID/token) never stored in plaintext in
 *     logs, reports, or commits. Redaction is the first line of defense —
 *     the real identifiers should never enter repository-controlled code.
 *
 * R5: Redaction is best-effort — if a pattern is not caught, the raw
 *     string may appear in output. Uncertain patterns are documented.
 */

// ─── Pattern constants ──────────────────────────────────────────────

/** UDID: 8-4-4-4-12 hex or 40-char hex string. */
const UDID_RE =
  /\b[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}\b|\b[a-fA-F0-9]{40}\b/g;

/** Email addresses. */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Apple Team ID: exactly 10 alphanumeric chars (observed pattern). */
const TEAM_ID_RE = /\b[A-Z0-9]{10}\b/g;

/** User home directory (cross-platform). */
const HOME_PATH_RE = /(?:\/Users\/[^/\s]+(?:\/[^\s]*)?|(?:\/home\/[^/\s]+(?:\/[^\s]*)?))/g;

/** IPv4 addresses (not loopback). */
const IPV4_RE = /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;

/** Common device name patterns from devicectl output. */
const DEVICE_NAME_RE =
  /(?:iPhone|iPad|iPod)\s*(?:[X\d]+\s*(?:Pro|Max|mini|Plus|Air)?\s*)?(?:(?:\b\d{2},\d\b)|(?:\([^)]*\)))?/gi;

// ─── Redaction function ────────────────────────────────────────────

/**
 * Redact sensitive identifiers from a string.
 *
 * Replaces: email → [email], UDID → [udid], Team ID → [team-id],
 * user home paths → [home-path], IP addresses → [ip], device names → [device].
 *
 * Best-effort — some patterns may not be caught (R5: explicit about limits).
 *
 * @param msg - The message to redact.
 * @returns The redacted message.
 */
export function redactError(msg: string): string {
  let redacted = msg;

  // Order matters: replace most-specific patterns first to avoid
  // partial replacements (e.g., email before home-path).
  redacted = redacted.replace(EMAIL_RE, '[email]');
  redacted = redacted.replace(UDID_RE, '[udid]');
  redacted = redacted.replace(TEAM_ID_RE, '[team-id]');
  redacted = redacted.replace(HOME_PATH_RE, '[home-path]');
  redacted = redacted.replace(IPV4_RE, '[ip]');
  redacted = redacted.replace(DEVICE_NAME_RE, '[device]');

  return redacted;
}

/**
 * Redact an error object, returning a redacted string.
 *
 * If the input is an Error, uses error.message. Otherwise converts to string.
 *
 * @param error - The error to redact.
 * @returns Redacted error message string.
 */
export function redactErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return redactError(msg);
}

// ─── Structured Redacting Logger (DEF-016) ──────────────────────

export interface RedactingLogger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
}

export function createRedactingLogger(component: string): RedactingLogger {
  const prefix = `[${component}]`;
  return {
    error(msg: string) {
      console.error(`${prefix} ${redactError(msg)}`);
    },
    warn(msg: string) {
      console.warn(`${prefix} ${redactError(msg)}`);
    },
    info(msg: string) {
      console.error(`${prefix} ${redactError(msg)}`);
    },
  };
}
