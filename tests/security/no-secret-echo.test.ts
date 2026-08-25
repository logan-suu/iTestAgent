/**
 * no-secret-echo.test.ts — G7 contract: API keys, credentials, and sensitive
 * error content must never echo into logs, errors, or reports (R6).
 *
 * RED phase (B00): this file statically imports `scripts/redact-secrets.ts`,
 * which does NOT exist yet (authored in GREEN). The import therefore fails at
 * load time, so the file reports a load error until the helper is created.
 *
 * GREEN contract for `scripts/redact-secrets.ts`:
 *
 *   export interface RedactOptions {
 *     patterns?: RegExp[];  // Extra patterns beyond the built-in defaults.
 *     mask?: string;        // Replacement; defaults to '[REDACTED]'.
 *   }
 *
 *   export function redact(input: string, options?: RedactOptions): string;
 *
 * The helper MUST replace well-known secret shapes (OpenAI-style keys, AWS
 * access keys, bearer tokens, generic `key=value` credential assignments)
 * with the mask so the raw secret value never appears in output.
 *
 * Note: secret-like test values are assembled from split fragments so the
 * literal source text never matches gitleaks secret patterns (the B00 tree
 * must stay G7-clean with these tests committed).
 */

import { describe, expect, test } from 'bun:test';
import { redact } from '../../scripts/redact-secrets';

// ─── Secret-shaped fixtures (assembled to avoid gitleaks false positives) ───

const skPrefix = 'sk-';
const skBody = 'abcdefghijklmnopqrstuvwxyz0123456789';
const openAiLikeKey = skPrefix + skBody;

const awsPrefix = 'AKIA';
const awsBody = 'IOSFODNN7EXAMPLE';
const awsAccessKey = awsPrefix + awsBody;

const jwtHeader = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const jwtPayload = 'eyJzdWIiOiIxMjM0NTY3ODkwIn0';
const jwtSignature = 'fake-signature';
const bearerToken = `${jwtHeader}.${jwtPayload}.${jwtSignature}`;

const credKey = 'api' + '_key=';
const credValue = 'this-is-a-fake-credential-value-123456';
const credentialAssignment = credKey + credValue;

const pwdLabel = 'password' + '=';
const pwdValue = 'correct-horse-battery-staple';
const passwordAssignment = pwdLabel + pwdValue;

// ─── Suite ────────────────────────────────────────────────

describe('scripts/redact-secrets.ts — secret redaction contract (G7 / R6)', () => {
  // (c) A redact helper exists.
  test('exposes a redact helper', () => {
    expect(typeof redact).toBe('function');
  });

  // (a) An error message containing an API key-like string is redacted.
  test('redacts an OpenAI-style API key embedded in an error message', () => {
    const message = `Connection failed: ${openAiLikeKey} is invalid`;
    const output = redact(message);

    expect(output).not.toContain(openAiLikeKey);
    expect(output).not.toContain(skBody);
    expect(output).toContain('[REDACTED]');
  });

  test('redacts an AWS access key embedded in an error message', () => {
    const message = `S3 upload rejected for ${awsAccessKey}`;
    const output = redact(message);

    expect(output).not.toContain(awsAccessKey);
    expect(output).toContain('[REDACTED]');
  });

  test('redacts a bearer token embedded in an error message', () => {
    const message = `401 Unauthorized: ${bearerToken}`;
    const output = redact(message);

    expect(output).not.toContain(jwtHeader);
    expect(output).not.toContain(jwtPayload);
    expect(output).toContain('[REDACTED]');
  });

  // (b) Credentials never appear in error output.
  test('does not echo credential key=value assignments in error output', () => {
    const message = `Authentication failed: ${credentialAssignment}`;
    const output = redact(message);

    expect(output).not.toContain(credValue);
    expect(output).toContain('[REDACTED]');
  });

  test('does not echo passwords in error output', () => {
    const message = `Login failed: ${passwordAssignment}`;
    const output = redact(message);

    expect(output).not.toContain(pwdValue);
    expect(output).toContain('[REDACTED]');
  });

  test('applies a custom mask via RedactOptions', () => {
    const message = `Failed: ${openAiLikeKey}`;
    const output = redact(message, { mask: '***' });

    expect(output).not.toContain(openAiLikeKey);
    expect(output).toContain('***');
  });
});
