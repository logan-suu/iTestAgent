import { describe, expect, it } from 'bun:test';
import { resolveSimulatorPlanReview } from '../src/simulator-plan-review.js';

describe('resolveSimulatorPlanReview', () => {
  it('carries the simulator selector through review', () => {
    expect(resolveSimulatorPlanReview({ selector: 'booted' }).selector).toBe('booted');
  });
});
