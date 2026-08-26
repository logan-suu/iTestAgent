/**
 * test-plan.test.ts — lightweight root smoke for the TestPlan contracts
 * (promotion batch B04).
 *
 * B04 split the former monolithic component/root coverage (guide §6.3:
 * remote contracts monolithic test replaced once the five replacement tests
 * land in the same commit):
 *
 *   - component schemas  → test-plan.component-schemas.test.ts
 *   - root + published   → test-plan.root.test.ts
 *   - MVP compiler       → mvp-execution.test.ts
 *   - plan⇄input mapping → test-plan.mvp-execution.test.ts
 *   - cross-module seams → test-plan.mvp-consistency.test.ts
 *
 * This file keeps only an end-to-end smoke: fixture round-trip through the
 * parse helpers, guarding against a future regression where the barrel or
 * schema module breaks standalone import.
 */
import { describe, expect, it } from 'bun:test';
import { TEST_PLAN_SCHEMA_VERSION, parseTestPlan, safeParseTestPlan } from '../src/test-plan.js';
import { makeValidTestPlan } from './test-plan.fixture.js';

describe('TestPlan smoke (post-B04 split)', () => {
  it('round-trips the canonical fixture through parseTestPlan', () => {
    const plan = makeValidTestPlan();
    expect(parseTestPlan(plan).schemaVersion).toBe(TEST_PLAN_SCHEMA_VERSION);
  });

  it('safeParseTestPlan rejects garbage without throwing', () => {
    expect(safeParseTestPlan(null).success).toBe(false);
    expect(safeParseTestPlan({}).success).toBe(false);
  });
});
