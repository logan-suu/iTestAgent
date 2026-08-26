import { describe, expect, it } from 'bun:test';
import { createTuiPlanReviewPort } from '../src/tui-plan-review-port.js';

describe('createTuiPlanReviewPort', () => {
  it('renders the plan through the port', () => {
    expect(createTuiPlanReviewPort({}).render({ planId: 'p1' }).ok).toBe(true);
  });
});
