/**
 * Durable TestPlan persistence — B14 module split (promotion guide §11.3
 * "engine compiler"; Data Flow Specification §6: plan.yaml stored at
 * ~/.itestagent/runs/<run_id>/plan.yaml, AC3 auditable/reproducible).
 *
 * Saves/loads the canonical YAML TestPlan document through an injectable fs
 * so the round-trip can be tested without touching the real store. File I/O
 * and path joining are the only responsibilities here — compilation and
 * YAML (de)serialization stay in test-plan-compiler.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestPlan } from 'itestagent-contracts';
import { parseTestPlanYaml, testPlanToYaml } from './test-plan-compiler.js';

export const PLAN_FILENAME = 'plan.yaml';

export interface DurableTestPlanDeps {
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
  join?: (...parts: string[]) => string;
}

/** Writes the canonical plan.yaml for a run directory. */
export async function saveTestPlanFile(
  runDir: string,
  plan: TestPlan,
  deps: DurableTestPlanDeps = {},
): Promise<{ path: string }> {
  const joinFn = deps.join ?? join;
  const writeFn = deps.writeFile ?? writeFile;
  const path = joinFn(runDir, PLAN_FILENAME);
  await writeFn(path, testPlanToYaml(plan));
  return { path };
}

/** Reads and validates plan.yaml back into a TestPlan. */
export async function loadTestPlanFile(
  runDir: string,
  deps: DurableTestPlanDeps = {},
): Promise<TestPlan> {
  const joinFn = deps.join ?? join;
  const readFn = deps.readFile ?? ((path: string) => readFile(path, 'utf-8'));
  const path = joinFn(runDir, PLAN_FILENAME);
  const yaml = await readFn(path);
  return parseTestPlanYaml(yaml);
}
