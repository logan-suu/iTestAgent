import { describe, expect, it } from 'bun:test';
import { migrateTestPlanV2 } from '../src/migrations/test-plan-v2.js';

describe('migrateTestPlanV2', () => {
  it('passes through a canonical v2 test plan', () => {
    const result = migrateTestPlanV2({ schemaVersion: 'itestagent.test-plan.v2', runId: 'r1' });
    expect(result.ok).toBe(true);
  });
});
