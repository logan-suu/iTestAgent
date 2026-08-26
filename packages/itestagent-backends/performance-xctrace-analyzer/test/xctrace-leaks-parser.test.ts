/**
 * xctrace-leaks-parser.test.ts — B21 leaks-report parsing (promotion guide
 * §11.3 "generic xctrace mechanics").
 *
 * The standard `leaks` summary line ("N leaks totaling M bytes") is the only
 * recognized shape; anything else fails closed rather than fabricating a
 * count (R5).
 */
import { describe, expect, it } from 'bun:test';
import { parseLeaksReport } from '../src/xctrace-leaks-parser.js';

describe('parseLeaksReport', () => {
  it('parses the standard leaks summary line', () => {
    expect(parseLeaksReport('Process 123 stopped.\n3 leaks totaling 4567 bytes')).toEqual({
      leakCount: 3,
      totalLeakedBytes: 4567,
    });
  });

  it('handles the zero-leak case', () => {
    expect(parseLeaksReport('0 leaks totaling 0 bytes')).toEqual({
      leakCount: 0,
      totalLeakedBytes: 0,
    });
  });

  it('fails closed on unrecognized output (R5)', () => {
    expect(() => parseLeaksReport('garbage output without a summary')).toThrow(
      /unrecognized output/,
    );
  });
});
