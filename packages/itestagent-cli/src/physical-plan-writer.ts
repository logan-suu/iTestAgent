/** B19: physical plan.yaml writer (injectable fs). */
export interface PhysicalPlanWriterDeps {
  writeFile?: (path: string, content: string) => Promise<void>;
}
export interface PhysicalPlanWriteResult {
  path: string;
}
export async function writePhysicalPlan(
  runDir: string,
  plan: { runId: string },
  deps: PhysicalPlanWriterDeps = {},
): Promise<PhysicalPlanWriteResult> {
  const writeFn =
    deps.writeFile ??
    (async (p: string, c: string) => {
      await import('node:fs/promises').then((m) => m.writeFile(p, c));
    });
  const path = `${runDir}/plan.yaml`;
  await writeFn(path, JSON.stringify(plan));
  return { path };
}
