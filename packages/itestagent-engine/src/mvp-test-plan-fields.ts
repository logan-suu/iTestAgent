/**
 * MVP TestPlan field gating — B14 module split (promotion guide §11.3
 * "engine compiler"; ADR-001 de-risk MVP).
 *
 * Locks the minimal set of TestPlan fields an MVP run must carry before
 * execution proceeds (run identity, explicit target/device, features to
 * cover, report outputs and baseline strategy). Missing or empty fields are
 * reported so the engine never starts with an underspecified plan (R8).
 */
import type { TestPlan } from 'itestagent-contracts';

/** Dot-paths to the MVP-required TestPlan fields. */
export const MVP_TEST_PLAN_FIELDS = [
  'runId',
  'projectProfileRef',
  'device',
  'appSource',
  'execution.features',
  'artifacts.report.outputs',
  'performance.baseline',
] as const;

function readField(plan: unknown, path: string): unknown {
  let current: unknown = plan;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Returns the subset of MVP-required fields that are missing or empty
 * (empty arrays/strings count as missing).
 */
export function missingMvpTestPlanFields(plan: TestPlan): string[] {
  return MVP_TEST_PLAN_FIELDS.filter((field) => {
    const value = readField(plan, field);
    if (value === undefined || value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.length === 0;
    return false;
  });
}
