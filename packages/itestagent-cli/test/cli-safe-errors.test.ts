/**
 * cli-safe-errors.test.ts — B17 CLI error-surface safety (promotion guide
 * §11.3 "CLI safety/config").
 *
 * Locks the public-error contract: explicit PublicCliError messages reach the
 * user verbatim; ANY other thrown value maps to a generic message so internal
 * details (paths, secrets, stack fragments) can never leak through CLI error
 * output.
 */
import { describe, expect, it } from 'bun:test';
import { PublicCliError, toPublicMessage } from '../src/public-error.js';

describe('PublicCliError', () => {
  it('carries its message verbatim and defaults exitCode to 1', () => {
    const error = new PublicCliError('explicit failure');
    expect(error.message).toBe('explicit failure');
    expect(error.exitCode).toBe(1);
    expect(error.name).toBe('PublicCliError');
  });

  it('supports a custom exit code', () => {
    expect(new PublicCliError('aborted by user', 130).exitCode).toBe(130);
  });
});

describe('toPublicMessage', () => {
  it('passes PublicCliError messages through untouched', () => {
    expect(toPublicMessage(new PublicCliError('Keychain unavailable'))).toBe(
      'Keychain unavailable',
    );
  });

  it('maps foreign errors to a generic message that hides internals', () => {
    const leaky = new Error(
      'ENOENT: no such file /Users/dev/itestagent-promotion/.itestagent/config.json contains s3cret-value',
    );
    const message = toPublicMessage(leaky);
    expect(message).toBe('Unexpected error occurred.');
    expect(message).not.toContain('/Users');
    expect(message).not.toContain('s3cret-value');
  });

  it('maps non-error thrown values to the generic message', () => {
    expect(toPublicMessage('raw string failure')).toBe('Unexpected error occurred.');
    expect(toPublicMessage(undefined)).toBe('Unexpected error occurred.');
  });
});
