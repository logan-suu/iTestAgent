/**
 * Credential prompt pure function unit tests.
 *
 * US-10.2 AC1-AC5: Credential prompt formatting, masking, validation, status display.
 * Pattern follows plan-review.test.ts — framework-independent, no renderer.
 */
import { describe, expect, it } from 'bun:test';
import type { CredentialKind, CredentialRequest, CredentialResponse } from 'itestagent-contracts';
import {
  formatCredentialPromptHeader,
  formatCredentialStatus,
  maskValue,
  validateCredentialInput,
} from '../src/credential-prompt.js';

// ─── Test helpers ───────────────────────────────────────────

function makeRequest(overrides: Partial<CredentialRequest> = {}): CredentialRequest {
  return {
    key: 'login_password',
    label: 'Login Password',
    kind: 'password',
    required: true,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<CredentialResponse> = {}): CredentialResponse {
  return {
    key: 'login_password',
    status: 'provided',
    value: 'my-secret-123',
    ...overrides,
  };
}

// ─── formatCredentialPromptHeader ───────────────────────────

describe('formatCredentialPromptHeader', () => {
  it('formats header with label only when no help text', () => {
    const result = formatCredentialPromptHeader('Login Password', undefined);
    expect(result).toBe('Login Password');
  });

  it('formats header with label and help text separated by em-dash', () => {
    const result = formatCredentialPromptHeader(
      'API Token',
      'Required for authenticated API access',
    );
    expect(result).toBe('API Token  — Required for authenticated API access');
  });

  it('formats header with empty string as label', () => {
    const result = formatCredentialPromptHeader('', 'some help');
    expect(result).toContain('some help');
  });
});

// ─── maskValue ──────────────────────────────────────────────

describe('maskValue', () => {
  it('masks password values', () => {
    expect(maskValue('my-secret-password', 'password')).toBe('****');
  });

  it('masks token values', () => {
    expect(maskValue('sk-abc123def456', 'token')).toBe('****');
  });

  it('masks otp values', () => {
    expect(maskValue('123456', 'otp')).toBe('****');
  });

  it('shows text values as-is', () => {
    expect(maskValue('myusername', 'text')).toBe('myusername');
  });

  it('returns empty string for empty value', () => {
    expect(maskValue('', 'password')).toBe('');
  });

  it('returns empty string for empty text value', () => {
    expect(maskValue('', 'text')).toBe('');
  });

  it('returns a string regardless of kind', () => {
    const kinds: CredentialKind[] = ['text', 'password', 'token', 'otp'];
    for (const kind of kinds) {
      const result = maskValue('test', kind);
      expect(typeof result).toBe('string');
    }
  });
});

// ─── formatCredentialStatus ─────────────────────────────────

describe('formatCredentialStatus', () => {
  it('shows provided status with session-only note', () => {
    const response = makeResponse({ status: 'provided' });
    const result = formatCredentialStatus(response);
    expect(result).toContain('Provided');
    expect(result).toContain('session-only');
  });

  it('shows provided status with Keychain note when remembered', () => {
    const response = makeResponse({ status: 'provided', remembered: true });
    const result = formatCredentialStatus(response);
    expect(result).toContain('Provided');
    expect(result).toContain('saved to Keychain');
  });

  it('shows skipped status', () => {
    const response = makeResponse({ status: 'skipped' });
    const result = formatCredentialStatus(response);
    expect(result).toContain('Skipped');
  });

  it('does not show session-only when remembered is true', () => {
    const response = makeResponse({ status: 'provided', remembered: true });
    const result = formatCredentialStatus(response);
    expect(result).not.toContain('session-only');
  });

  it('does not show Keychain when remembered is false', () => {
    const response = makeResponse({ status: 'provided', remembered: false });
    const result = formatCredentialStatus(response);
    expect(result).not.toContain('Keychain');
  });
});

// ─── validateCredentialInput ────────────────────────────────

describe('validateCredentialInput', () => {
  it('rejects empty input for required credentials', () => {
    const result = validateCredentialInput('', 'password', true);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('required');
  });

  it('rejects whitespace-only input for required credentials', () => {
    const result = validateCredentialInput('   ', 'password', true);
    expect(result.valid).toBe(false);
  });

  it('accepts empty input for non-required credentials', () => {
    const result = validateCredentialInput('', 'text', false);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts non-empty input for required credentials', () => {
    const result = validateCredentialInput('my-password', 'password', true);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts any input when not required', () => {
    const result = validateCredentialInput('  spaced  ', 'token', false);
    expect(result.valid).toBe(true);
  });

  it('validates for text kind with required=true', () => {
    const result = validateCredentialInput('username', 'text', true);
    expect(result.valid).toBe(true);
  });

  it('validates for otp kind with required=true and value', () => {
    const result = validateCredentialInput('654321', 'otp', true);
    expect(result.valid).toBe(true);
  });

  it('validates for token kind with required=true and value', () => {
    const result = validateCredentialInput('ghp_xxxx', 'token', true);
    expect(result.valid).toBe(true);
  });
});
