/**
 * report-sanitizer-context.test.ts — B09 report sanitization coverage
 * (promotion guide §11.3 "report validation", §6.1 "report sanitization").
 *
 * Locks the default redaction rules: Apple UDID-shaped identifiers and
 * absolute home paths are masked before any report text is written (R6 —
 * no raw device identity or machine paths in reports).
 */
import { describe, expect, it } from 'bun:test';
import { REPORT_REDACTION_RULES, sanitizeReportText } from '../src/report-sanitizer.js';

describe('sanitizeReportText default rules', () => {
  it('masks Apple UDID-shaped identifiers', () => {
    const result = sanitizeReportText('Device 12345678-1234567890ABCDEF paired');
    expect(result.text).toContain('[REDACTED-UDID]');
    expect(result.text).not.toContain('12345678-1234567890ABCDEF');
    expect(result.redactions).toBe(1);
  });

  it('masks absolute home paths', () => {
    const result = sanitizeReportText('log written to /Users/dev/fixture/x.log');
    expect(result.text).not.toContain('/Users/dev');
    expect(result.redactions).toBeGreaterThanOrEqual(1);
  });

  it('leaves clean text untouched with zero redactions', () => {
    const input = 'Run finished: 3 passed, 0 failed.';
    const result = sanitizeReportText(input);
    expect(result.text).toBe(input);
    expect(result.redactions).toBe(0);
  });

  it('counts redactions cumulatively across multiple rules', () => {
    const result = sanitizeReportText('udid 12345678-1234567890ABCDEF at /home/runner/x.log');
    expect(result.redactions).toBeGreaterThanOrEqual(2);
  });

  it('exposes the default rule table for auditing', () => {
    expect(REPORT_REDACTION_RULES.map((rule) => rule.name)).toEqual(['apple_udid', 'home_path']);
  });
});
