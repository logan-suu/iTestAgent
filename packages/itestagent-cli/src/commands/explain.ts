import { isDeepStrictEqual } from 'node:util';
import type { RunResult, TestPlan } from 'itestagent-contracts';
import { FailureExplainer } from 'itestagent-engine';
import { createRunStore, createStoreCore, resolveStoreRoot } from 'itestagent-store';
import type { RunStore } from 'itestagent-store';

export interface ExplainCommandDependencies {
  store?: RunStore;
  storeRoot?: string;
}

function rerunPlansAreComparable(child: TestPlan, parent: TestPlan): boolean {
  const { runId: _childRunId, rerun: _childRerun, ...childSemantics } = child;
  const { runId: _parentRunId, rerun: _parentRerun, ...parentSemantics } = parent;
  return isDeepStrictEqual(childSemantics, parentSemantics);
}

function rerunResultsShareCase(child: RunResult, parent: RunResult): boolean {
  const childCases = new Set(child.cases.map((testCase) => testCase.caseId));
  return parent.cases.some((testCase) => childCases.has(testCase.caseId));
}

async function resolveStore(dependencies: ExplainCommandDependencies): Promise<RunStore> {
  if (dependencies.store) return dependencies.store;
  const storeRoot = dependencies.storeRoot ?? resolveStoreRoot();
  const core = createStoreCore(`${storeRoot}/db/itestagent.db`);
  await core.driver.migrate();
  return createRunStore(core.db, storeRoot);
}

/** Shared read-only production handler used by Commander and integration tests. */
export async function runExplainCommand(
  runId: string,
  dependencies: ExplainCommandDependencies = {},
) {
  const store = await resolveStore(dependencies);
  const bundle =
    runId === 'latest' ? await store.findLatestValidBundle() : await store.loadRunBundle(runId);
  if (!bundle) {
    throw new Error(`No runs found${runId === 'latest' ? '' : ` — run "${runId}" not found`}.`);
  }
  const runResult = bundle.result;
  let previousRuns: Array<{
    runId: string;
    status: typeof runResult.status;
    scenario: string;
    comparable: boolean;
  }> = [];
  if (runResult.parentRunId && bundle.plan.schemaVersion === 'itestagent.test-plan.v3') {
    try {
      const parent = await store.loadRunBundle(runResult.parentRunId);
      const plansComparable =
        parent.plan.schemaVersion === 'itestagent.test-plan.v3' &&
        rerunPlansAreComparable(bundle.plan, parent.plan);
      previousRuns = [
        {
          runId: parent.result.runId,
          status: parent.result.status,
          scenario: parent.result.cases.map((testCase) => testCase.caseId).join(','),
          comparable:
            plansComparable &&
            parent.result.projectProfileRef === runResult.projectProfileRef &&
            parent.result.environment.targetKind === runResult.environment.targetKind &&
            rerunResultsShareCase(runResult, parent.result),
        },
      ];
    } catch {
      previousRuns = [];
    }
  }
  const explanation =
    runResult.explanation ??
    (await new FailureExplainer().explain({
      runId: runResult.runId,
      status: runResult.status,
      projectProfileRef: runResult.projectProfileRef,
      steps: bundle.steps.steps,
      evidence: bundle.artifactIndex.artifacts,
      collectionOutcomes: bundle.artifactIndex.collectionOutcomes,
      baselineDelta: runResult.baselineDelta,
      targetKind: runResult.environment.targetKind,
      previousRuns,
    }));
  return { runId: runResult.runId, result: runResult, explanation };
}

export function formatExplainCommand(
  output: Awaited<ReturnType<typeof runExplainCommand>>,
  json = false,
): string {
  if (json) {
    return JSON.stringify(
      { runId: output.runId, status: output.result.status, explanation: output.explanation },
      null,
      2,
    );
  }
  const lines = [
    '',
    `Run     : ${output.runId}`,
    `Status  : ${output.result.status}`,
    `Target  : ${output.result.environment.targetKind}`,
    '─'.repeat(50),
    '',
    `Failure Type: ${output.explanation.explanationType}`,
    `Confidence  : ${output.explanation.confidence ?? 'N/A'}`,
    '',
    output.explanation.summary,
  ];
  if (output.explanation.evidence.length > 0) {
    lines.push('', 'Evidence:', ...output.explanation.evidence.map((item) => `  • ${item}`));
  }
  if (output.explanation.suggestedActions?.length) {
    lines.push(
      '',
      'Suggested Actions:',
      ...output.explanation.suggestedActions.map((item) => `  → ${item}`),
    );
  }
  lines.push('');
  return lines.join('\n');
}
