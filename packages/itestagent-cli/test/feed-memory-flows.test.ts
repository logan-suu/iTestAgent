import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryFlows } from '../src/feed-memory-flows.js';

describe('resolveFeedMemoryFlows', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryFlows({});
    expect(result).toBeDefined();
  });
});
