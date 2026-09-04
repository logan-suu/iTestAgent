import { randomUUID } from 'node:crypto';
import {
  PermissionEngine,
  type ProductionAgentSessionDependencies,
  type ProductionExecutionTransports,
  createProductionAgentSessionDependencies,
  createRerunPlan,
  executeProductionTestPlan,
  loadProductionPlanContext,
  selectPlanDevice,
} from 'itestagent-engine';
import type { RunStore } from 'itestagent-store';
import { createRunStore, createStoreCore, resolveStoreRoot } from 'itestagent-store';
import { confirmAction } from '../config/confirm.js';
import { PublicCliError } from '../public-error.js';

export interface RerunCommandDependencies {
  store?: RunStore;
  storeRoot?: string;
  workspace?: string;
  production?: ProductionAgentSessionDependencies;
  transports?: ProductionExecutionTransports;
  authorize?: (action: string, resource: string) => Promise<boolean>;
  runId?: string;
}

/** Shared production rerun handler used by Commander and integration tests. */
export async function runRerunCommand(
  parentRunId: string,
  options: { failedOnly?: boolean },
  dependencies: RerunCommandDependencies = {},
) {
  const storeRoot = dependencies.storeRoot ?? resolveStoreRoot();
  let store = dependencies.store;
  if (!store) {
    const core = createStoreCore(`${storeRoot}/db/itestagent.db`);
    await core.driver.migrate();
    store = createRunStore(core.db, storeRoot);
  }
  const parent = await store.loadRunBundle(parentRunId);
  if (parent.plan.schemaVersion !== 'itestagent.test-plan.v3') {
    throw new PublicCliError(
      'Flow replay bundles cannot be rerun as TestPlans; use `itestagent run flow <flowId>`.',
    );
  }
  const childPlan = createRerunPlan({
    parentPlan: parent.plan,
    parentResult: parent.result,
    mode: options.failedOnly ? 'failed_only' : 'all',
    ...(dependencies.runId ? { runId: dependencies.runId } : {}),
  });
  const context = loadProductionPlanContext(
    childPlan,
    storeRoot,
    dependencies.workspace ?? process.cwd(),
  );
  const production = dependencies.production ?? createProductionAgentSessionDependencies();
  const discovered = await production.deviceDiscovery.discover();
  const device = selectPlanDevice(childPlan, discovered.devices);
  const permissionEngine = new PermissionEngine();
  const authorize =
    dependencies.authorize ??
    (async (action: string, resource: string): Promise<boolean> => {
      const gate = permissionEngine.check(action, resource);
      if (gate === 'allow') return true;
      if (gate === 'deny') return false;
      const callId = `rerun-${randomUUID()}`;
      const pending = permissionEngine.requestPermission(callId, action, resource);
      const answer = await confirmAction({ action, details: resource });
      permissionEngine.resolve(callId, answer === 'yes' ? 'allow' : 'deny', false);
      return (await pending).effect === 'allow';
    });
  const executed = await executeProductionTestPlan({
    plan: childPlan,
    parentResult: parent.result,
    workspace: context.workspace,
    device,
    bundleId: context.bundleId,
    store,
    storeRoot,
    suggest: async () => {
      throw new PublicCliError('XCUITest rerun does not use model-driven exploration.');
    },
    authorize,
    production,
    transports: dependencies.transports,
  });
  const child = await store.loadRunBundle(childPlan.runId);
  return { parentRunId, childPlan, child, executed };
}

export function formatRerunCommand(output: Awaited<ReturnType<typeof runRerunCommand>>): string {
  return [
    '',
    `Rerun    : ${output.childPlan.runId}`,
    `Parent   : ${output.parentRunId}`,
    `Cases    : ${output.childPlan.rerun?.selectedCaseIds.join(', ')}`,
    `Status   : ${output.child.result.status}`,
    `Run dir  : ${output.executed.runDir}`,
  ].join('\n');
}
