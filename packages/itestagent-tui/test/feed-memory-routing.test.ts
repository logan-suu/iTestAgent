import { describe, expect, it } from 'bun:test';
import { routeFeedMemoryTui } from '../src/feed-memory-plan-format.js';

describe('routeFeedMemoryTui', () => {
  it('resolves a sensible default', () => {
    const result = routeFeedMemoryTui({});
    expect(result).toBeDefined();
  });
});
