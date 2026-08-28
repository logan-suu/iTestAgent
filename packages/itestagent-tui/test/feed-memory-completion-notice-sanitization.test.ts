import { describe, expect, it } from 'bun:test';
import { sanitizeCompletionNotice } from '../src/feed-memory-analysis-review.js';

describe('sanitizeCompletionNotice', () => {
  it('resolves a sensible default', () => {
    const result = sanitizeCompletionNotice({ text: 'hi' });
    expect(result).toBeDefined();
  });
});
