/**
 * Tests for xctrace-version-compat — Xcode version detection and schema compatibility.
 *
 * Trap Handbook §6: xctrace export XML schema changes across Xcode versions.
 * Xcode 26 introduces Deferred recording mode, parsing must be compatible.
 */

import { describe, expect, it } from 'bun:test';
import {
  detectXcodeVersion,
  getKnownSchemasForVersion,
  hasKnownSchemaChanges,
  resolveColumnName,
  resolveSchemaName,
  toVersionKey,
} from '../src/xctrace-version-compat.js';

// ─── detectXcodeVersion ───────────────────────────────────────────

describe('detectXcodeVersion', () => {
  it('parses Xcode 16.0 version string', () => {
    const v = detectXcodeVersion('xctrace version 16.0 (2040.3)');
    expect(v).not.toBeNull();
    expect(v?.major).toBe(16);
    expect(v?.minor).toBe(0);
    expect(v?.raw).toBe('xctrace version 16.0 (2040.3)');
  });

  it('parses Xcode 16.2 version string', () => {
    const v = detectXcodeVersion('xctrace version 16.2');
    expect(v).not.toBeNull();
    expect(v?.major).toBe(16);
    expect(v?.minor).toBe(2);
  });

  it('parses Xcode 26.0 version string', () => {
    const v = detectXcodeVersion('xctrace version 26.0 (Deferred)');
    expect(v).not.toBeNull();
    expect(v?.major).toBe(26);
    expect(v?.minor).toBe(0);
  });

  it('returns null for unrecognized format', () => {
    expect(detectXcodeVersion('xctrace: command not found')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectXcodeVersion('')).toBeNull();
  });

  it('handles version with unexpected whitespace', () => {
    const v = detectXcodeVersion('  xctrace version  15.3  ');
    expect(v).not.toBeNull();
    expect(v?.major).toBe(15);
    expect(v?.minor).toBe(3);
  });
});

// ─── toVersionKey ─────────────────────────────────────────────────

describe('toVersionKey', () => {
  it('generates X16 key for v16.0', () => {
    expect(toVersionKey({ major: 16, minor: 0, raw: '' })).toBe('X16');
  });

  it('generates X26 key for v26.0', () => {
    expect(toVersionKey({ major: 26, minor: 0, raw: '' })).toBe('X26');
  });
});

// ─── resolveSchemaName ────────────────────────────────────────────

describe('resolveSchemaName', () => {
  it('returns Hitch for Xcode 16', () => {
    const name = resolveSchemaName('Hitch', { major: 16, minor: 0, raw: '' });
    expect(name).toBe('Hitch');
  });

  it('returns HitchData for Xcode 26 (Deferred mode)', () => {
    const name = resolveSchemaName('Hitch', { major: 26, minor: 0, raw: '' });
    expect(name).toBe('HitchData');
  });

  it('returns App Launch unchanged across versions', () => {
    expect(resolveSchemaName('App Launch', { major: 16, minor: 0, raw: '' })).toBe('App Launch');
    expect(resolveSchemaName('App Launch', { major: 26, minor: 0, raw: '' })).toBe('App Launch');
  });

  it('falls back to canonical for unknown schema', () => {
    const name = resolveSchemaName('UnknownSchema', { major: 16, minor: 0, raw: '' });
    expect(name).toBe('UnknownSchema');
  });

  it('falls back to canonical for unknown version', () => {
    // Xcode 27 — no compat mapping yet
    const name = resolveSchemaName('Hitch', { major: 27, minor: 0, raw: '' });
    expect(name).toBe('Hitch');
  });
});

// ─── resolveColumnName ────────────────────────────────────────────

describe('resolveColumnName', () => {
  it('returns canonical column name for Xcode 16', () => {
    const col = resolveColumnName('Hitch', 'hitch_ratio', { major: 16, minor: 0, raw: '' });
    expect(col).toBe('hitch_ratio');
  });

  it('returns version-specific column name for Xcode 26', () => {
    const col = resolveColumnName('Hitch', 'hitch_ratio', { major: 26, minor: 0, raw: '' });
    expect(col).toBe('hitch_ratio_pct');
  });

  it('resolves duration_ms column across versions', () => {
    expect(resolveColumnName('Hitch', 'hitch_duration_ms', { major: 16, minor: 0, raw: '' })).toBe(
      'hitch_duration_ms',
    );
    expect(resolveColumnName('Hitch', 'hitch_duration_ms', { major: 26, minor: 0, raw: '' })).toBe(
      'dur_us',
    );
  });

  it('falls back to canonical for unknown column', () => {
    const col = resolveColumnName('Hitch', 'unknown_column', { major: 16, minor: 0, raw: '' });
    expect(col).toBe('unknown_column');
  });

  it('falls back to canonical for unknown schema', () => {
    const col = resolveColumnName('Unknown', 'my_column', { major: 16, minor: 0, raw: '' });
    expect(col).toBe('my_column');
  });
});

// ─── hasKnownSchemaChanges ────────────────────────────────────────

describe('hasKnownSchemaChanges', () => {
  it('returns true for Xcode 26+', () => {
    expect(hasKnownSchemaChanges({ major: 26, minor: 0, raw: '' })).toBe(true);
  });

  it('returns false for Xcode 16', () => {
    expect(hasKnownSchemaChanges({ major: 16, minor: 0, raw: '' })).toBe(false);
  });

  it('returns false for Xcode 15', () => {
    expect(hasKnownSchemaChanges({ major: 15, minor: 3, raw: '' })).toBe(false);
  });
});

// ─── getKnownSchemasForVersion ────────────────────────────────────

describe('getKnownSchemasForVersion', () => {
  it('returns X16 schema names', () => {
    const schemas = getKnownSchemasForVersion({ major: 16, minor: 0, raw: '' });
    expect(schemas).toContain('Hitch');
    expect(schemas).toContain('App Launch');
    expect(schemas).toContain('Hangs');
    expect(schemas).toContain('VM');
  });

  it('returns X26 schema names with HitchData', () => {
    const schemas = getKnownSchemasForVersion({ major: 26, minor: 0, raw: '' });
    expect(schemas).toContain('HitchData');
    expect(schemas).toContain('App Launch');
    expect(schemas).not.toContain('Hitch'); // HitchData replaces Hitch in X26
  });

  it('falls back to canonical for unknown version (X27)', () => {
    const schemas = getKnownSchemasForVersion({ major: 27, minor: 0, raw: '' });
    expect(schemas).toContain('Hitch'); // Falls back to canonical
    expect(schemas).toContain('App Launch');
  });
});

// ─── B21 seam: leaks summary parser ────────────────────────────────

describe('B21 seam: leaks report parser', () => {
  it('parses the standard zero-leak line through the split module', async () => {
    const mod = await import('../src/xctrace-leaks-parser.js');
    expect(mod.parseLeaksReport('0 leaks totaling 0 bytes')).toEqual({
      leakCount: 0,
      totalLeakedBytes: 0,
    });
  });
});
