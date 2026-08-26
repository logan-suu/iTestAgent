import { describe, expect, it } from 'bun:test';
import { resolveMemoryProfilePlanReview } from '../src/memory-profile-plan-review.js';

describe('resolveMemoryProfilePlanReview', () => {
  it('carries the threshold through review', () => {
    expect(resolveMemoryProfilePlanReview({ thresholdMB: 20 }).thresholdMB).toBe(20);
  });
});
