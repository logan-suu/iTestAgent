import { describe, expect, it } from 'bun:test';
import { retainMessages } from '../src/message-retention.js';

describe('retainMessages', () => {
  it('keeps the newest messages within the retention window', () => {
    const kept = retainMessages([1, 2, 3, 4, 5], 3);
    expect(kept).toEqual([3, 4, 5]);
  });
  it('returns empty for a zero window', () => {
    expect(retainMessages([1, 2], 0)).toEqual([]);
  });
  it('passes through when under the window', () => {
    expect(retainMessages([1, 2], 5)).toEqual([1, 2]);
  });
});
