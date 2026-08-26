/**
 * memory-profile-parsers.test.ts — B22 memory sample parsing (promotion
 * guide §11.3 "parameterized memory profile").
 *
 * Locks the "timestamp:valueMB" sample-sequence parser used to fold raw
 * profiling output into per-round memory summaries; unparseable input fails
 * closed (R5).
 */
import { describe, expect, it } from 'bun:test';
import { parseMemorySamples } from '../src/memory-profile-parsers.js';

describe('parseMemorySamples', () => {
  it('parses a comma-separated timestamp:valueMB sequence', () => {
    const samples = parseMemorySamples('0:10.5,1000:12.0,2000:11.0');
    expect(samples).toHaveLength(3);
    expect(samples[0]).toEqual({ timestampMs: 0, valueMB: 10.5 });
    expect(samples[2]).toEqual({ timestampMs: 2000, valueMB: 11.0 });
  });

  it('returns an empty list for empty input', () => {
    expect(parseMemorySamples('')).toEqual([]);
  });

  it('fails closed on unparseable tokens', () => {
    expect(() => parseMemorySamples('not-a-sample')).toThrow(/unparseable/);
  });
});
