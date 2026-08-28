import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryPlanReview } from '../src/feed-memory-plan-review.js';

describe('resolveFeedMemoryPlanReview', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryPlanReview({});
    expect(result).toBeDefined();
  });
});
