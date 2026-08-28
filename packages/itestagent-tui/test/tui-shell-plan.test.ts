import { describe, expect, it } from 'bun:test';
import { resolvePlanReviewIntent } from '../src/plan-review-intent.js';

describe('resolvePlanReviewIntent', () => {
  it('classifies a review intent by target kind', () => {
    expect(resolvePlanReviewIntent({ targetKind: 'physical' }).lane).toBe('physical');
  });
});
