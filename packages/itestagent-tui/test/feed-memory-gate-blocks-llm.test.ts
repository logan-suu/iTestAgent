import { describe, expect, it } from 'bun:test';
import { feedMemoryGateBlocksLlm } from '../src/feed-memory-analysis-review.js';

describe('feedMemoryGateBlocksLlm', () => {
  it('resolves a sensible default', () => {
    const result = feedMemoryGateBlocksLlm({ gated: true });
    expect(result).toBeDefined();
  });
});
