import { describe, expect, it } from 'bun:test';
import { approvePlanReview } from '../src/plan-review.js';

describe('approvePlanReview', () => {
  it('returns the plan when approved', () => {
    expect(approvePlanReview({ planId: 'p1' }, true).approved).toBe(true);
  });
  it('rejects when declined', () => {
    expect(approvePlanReview({ planId: 'p1' }, false).approved).toBe(false);
  });
});
