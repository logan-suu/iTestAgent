import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryProduction } from '../src/feed-memory-production.js';

describe('resolveFeedMemoryProduction', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryProduction({});
    expect(result).toBeDefined();
  });
});
