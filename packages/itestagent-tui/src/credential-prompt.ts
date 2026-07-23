/**
 * Credential prompt mode — pure functions for credential display and input handling.
 *
 * US-10.2 AC1-AC5:
 *   AC1: Real account/OTP/payment/permission/token prompted in TUI.
 *   AC2: Default session-only, not persisted to disk.
 *   AC3: User chooses "remember" to save to Keychain.
 *   AC4: Password/token/otp masked during input (never shown in TUI).
 *   AC5: Skip non-required credentials; required → flow unable to complete.
 *
 * This module is framework-independent and testable without a renderer.
 * Follows the same pattern as plan-review.ts.
 *
 * R6: Sensitive data never logged, persisted in plaintext, or included in reports.
 */
import type { CredentialKind, CredentialRequest, CredentialResponse } from 'itestagent-contracts';

// ─── Public API ──────────────────────────────────────────────

/**
 * Format the credential prompt header line.
 *
 * Combines the credential label with optional help text for context.
 *
 * @param label - Human-readable credential name (e.g. "Login Password")
 * @param helpText - Optional explanation of why this credential is needed
 * @returns Formatted header string for TUI display
 */
export function formatCredentialPromptHeader(label: string, helpText?: string): string {
  if (helpText) {
    return `${label}  — ${helpText}`;
  }
  return label;
}

/**
 * Mask a credential value for display based on its kind.
 *
 * AC4: password, token, and otp kinds are always shown as '****'.
 * text kind is shown as-is (non-sensitive).
 *
 * @param value - The credential value to potentially mask
 * @param kind - The kind of credential (determines masking behavior)
 * @returns Masked or original value string
 */
export function maskValue(value: string, kind: CredentialKind): string {
  if (!value) return '';

  switch (kind) {
    case 'password':
    case 'token':
    case 'otp':
      return '****';
    case 'text':
      return value;
  }
}

/**
 * Format a human-readable status line for a CredentialResponse.
 *
 * AC2: "Provided (session-only)" — default, not persisted.
 * AC3: "Provided (saved to Keychain)" — user chose to remember.
 * AC5: "Skipped" — user opted not to provide.
 *
 * @param response - The credential response to format
 * @returns Human-readable status string
 */
export function formatCredentialStatus(response: CredentialResponse): string {
  if (response.status === 'skipped') {
    return '✗ Skipped';
  }

  if (response.remembered) {
    return '✓ Provided (saved to Keychain)';
  }

  return '✓ Provided (session-only)';
}

/**
 * Validate credential input based on kind and required flag.
 *
 * @param input - The raw input value from the user
 * @param kind - The kind of credential (for future kind-specific validation)
 * @param required - Whether this credential is required (AC5)
 * @returns Validation result with valid flag and optional error message
 */
export function validateCredentialInput(
  input: string,
  _kind: CredentialKind,
  required: boolean,
): { valid: boolean; error?: string } {
  if (!required) {
    return { valid: true };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Value is required for this credential' };
  }

  return { valid: true };
}
