/**
 * Tests for signing-diagnostics.ts — parsing xcodebuild output for signing errors.
 *
 * Coverage:
 *   - 6 signing error patterns: no_provisioning_profile, no_signing_certificate,
 *     profile_expired, cert_expired, team_permission_denied, bundle_id_mismatch
 *   - hasSigningError() returns true/false
 *   - Non-signing errors return null
 *   - Edge cases: empty string, whitespace, missing context
 */

import { describe, expect, it } from 'bun:test';
import { diagnoseSigningError, hasSigningError } from '../src/signing-diagnostics.js';

// ─── Pattern 1: no_provisioning_profile ───────────────────────────

describe('no_provisioning_profile', () => {
  it('detects "No provisioning profile found"', () => {
    const output = 'error: No provisioning profile found for bundle identifier com.example.app';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.reason).toContain('provisioning profile');
    expect(diag?.fixGuide.length).toBeGreaterThan(0);
    expect(diag?.matchedPattern).toBe('no_provisioning_profile');
  });

  it('matches case-insensitively', () => {
    const output = 'ERROR: No Provisioning Profile matching com.foo.bar was found.';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.matchedPattern).toBe('no_provisioning_profile');
  });

  it('hasSigningError returns true', () => {
    expect(hasSigningError('No provisioning profile found')).toBe(true);
  });
});

// ─── Pattern 2: no_signing_certificate ────────────────────────────

describe('no_signing_certificate', () => {
  it('detects "No signing certificate"', () => {
    const output = 'error: No signing certificate for "iPhone Developer" found';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.reason).toContain('signing certificate');
    expect(diag?.fixGuide.length).toBeGreaterThan(0);
    expect(diag?.matchedPattern).toBe('no_signing_certificate');
  });

  it('detects "code signing identity not found"', () => {
    const output =
      'error: Code Signing Identity "iPhone Developer: dev@example.com" not found in keychain';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.matchedPattern).toBe('no_signing_certificate');
  });

  it('hasSigningError returns true', () => {
    expect(hasSigningError('No signing certificate for X not found')).toBe(true);
  });
});

// ─── Pattern 3: profile_expired ───────────────────────────────────

describe('profile_expired', () => {
  it('detects "Provisioning profile has expired"', () => {
    const output =
      'error: Provisioning profile "iOS Team Provisioning Profile: com.example.app" has expired.';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.reason).toContain('expired');
    expect(diag?.fixGuide.length).toBeGreaterThan(0);
    expect(diag?.matchedPattern).toBe('profile_expired');
  });
});

// ─── Pattern 4: cert_expired ──────────────────────────────────────

describe('cert_expired', () => {
  it('detects "certificate has expired" with code sign context', () => {
    const output =
      'error: The code signing certificate "iPhone Developer: dev@example.com" has expired.';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.reason).toContain('expired');
    expect(diag?.matchedPattern).toBe('cert_expired');
  });
});

// ─── Pattern 5: team_permission_denied ────────────────────────────

describe('team_permission_denied', () => {
  it('detects "does not have permission"', () => {
    const output =
      'error: "Apple Development" does not have permission to create provisioning profiles for the team "ABCDEF1234".';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.reason).toContain('permission');
    expect(diag?.fixGuide.length).toBeGreaterThan(0);
    expect(diag?.matchedPattern).toBe('team_permission_denied');
  });

  it('detects "No account for team"', () => {
    const output =
      'error: No account for team "ABCDEF1234". Add an account in the Accounts preference pane.';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.matchedPattern).toBe('team_permission_denied');
  });
});

// ─── Pattern 6: bundle_id_mismatch ────────────────────────────────

describe('bundle_id_mismatch', () => {
  it('detects "bundle identifier cannot be verified"', () => {
    const output =
      'error: The bundle identifier "com.example.app" cannot be verified. No App ID with bundle identifier "com.example.app" is available.';
    const diag = diagnoseSigningError(output);
    expect(diag).not.toBeNull();
    expect(diag?.reason).toContain('bundle identifier');
    expect(diag?.fixGuide.length).toBeGreaterThan(0);
    expect(diag?.matchedPattern).toBe('bundle_id_mismatch');
  });
});

// ─── Non-signing errors ───────────────────────────────────────────

describe('non-signing errors', () => {
  it('returns null for compilation error', () => {
    const output =
      'error: use of unresolved identifier FooBar\nclang: error: linker command failed with exit code 1';
    expect(diagnoseSigningError(output)).toBeNull();
  });

  it('returns null for linker error', () => {
    const output =
      'ld: symbol(s) not found for architecture arm64\nclang: error: linker command failed';
    expect(diagnoseSigningError(output)).toBeNull();
  });

  it('returns null for generic build failure', () => {
    const output =
      '** BUILD FAILED **\nThe following build commands failed:\n\tCompileSwift normal arm64';
    expect(diagnoseSigningError(output)).toBeNull();
  });

  it('hasSigningError returns false for non-signing errors', () => {
    expect(hasSigningError('clang: error: no such file or directory')).toBe(false);
    expect(hasSigningError('** BUILD FAILED **')).toBe(false);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────

describe('edge cases', () => {
  it('returns null for empty string', () => {
    expect(diagnoseSigningError('')).toBeNull();
  });

  it('returns null for whitespace-only', () => {
    expect(diagnoseSigningError('   \n  \t  ')).toBeNull();
  });

  it('returns null for unrelated output', () => {
    expect(diagnoseSigningError('Binary garbage \x00\x01\x02\xFF')).toBeNull();
  });

  it('hasSigningError returns false for empty string', () => {
    expect(hasSigningError('')).toBe(false);
  });
});

// ─── Structure verification ───────────────────────────────────────

describe('diagnostic structure', () => {
  it('every pattern returns non-empty fixGuide', () => {
    const patterns = [
      'No provisioning profile found for com.example.app',
      'No signing certificate for iPhone Developer not found',
      'Provisioning profile com.example.app has expired',
      'Code signing certificate iPhone Developer has expired',
      'Team does not have permission to create profiles',
      'Bundle identifier com.example.app cannot be verified',
    ];

    for (const output of patterns) {
      const diag = diagnoseSigningError(output);
      expect(diag, `Pattern "${output}" did not match`).not.toBeNull();
      expect(diag?.reason.length).toBeGreaterThan(0);
      expect(diag?.fixGuide.length).toBeGreaterThan(0);
      expect(diag?.matchedPattern).toBeDefined();
    }
  });
});
