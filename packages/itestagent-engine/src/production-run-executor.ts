import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { DeviceInfo, RunResult, TestPlan } from 'itestagent-contracts';
import { loadProfile } from 'itestagent-project-analyzer';
import type { RunStore } from 'itestagent-store';
import { persistConfirmedRun } from './confirmed-run-bundle.js';
import {
  type ConfirmedExecutionDispatchResult,
  DeviceBackendCleanupError,
} from './dual-execution-dispatcher.js';
import { assertProviderUrl } from './exploration/assertion-suggester.js';
import {
  type ExplorationAction,
  createBackendToolDispatcher,
  runRealDeviceExploration,
  suggestExplorationAction,
} from './exploration/index.js';
import {
  type ProductionAgentSessionDependencies,
  createProductionAgentSessionDependencies,
  createProductionDualExecutionDispatcher,
} from './production-agent-session.js';

export type ProductionActionSuggestion = (input: {
  caseId: string;
  uiTree: string;
  history: readonly import('itestagent-contracts').RunStep[];
  signal?: AbortSignal;
}) => Promise<ExplorationAction | 'done'>;

/** Build the model-backed DeviceBackend action suggestion at the engine boundary. */
export function createProductionActionSuggestion(input: {
  apiKey: string;
  model?: string;
  baseURL?: string;
}): ProductionActionSuggestion {
  if (input.baseURL) assertProviderUrl(input.baseURL);
  const model = createOpenAI({ apiKey: input.apiKey, baseURL: input.baseURL }).chat(
    input.model ?? 'gpt-4o',
  );
  return ({ caseId, uiTree, history, signal }) =>
    suggestExplorationAction({
      generate: async (prompt, runSignal) =>
        (await generateText({ model, prompt, abortSignal: runSignal })).text,
      caseId,
      uiTree,
      history,
      signal,
    });
}

export interface ProductionRunExecutorInput {
  plan: TestPlan;
  parentResult?: RunResult;
  workspace: string;
  device: DeviceInfo;
  bundleId: string;
  store: RunStore;
  storeRoot: string;
  suggest: ProductionActionSuggestion;
  authorize(action: string, resource: string): Promise<boolean>;
  /** True when this invocation will build, sign, or launch a managed WDA. */
  preparesWda?: boolean;
  /** Injectable production adapters for deterministic transport tests. */
  production?: ProductionAgentSessionDependencies;
  signal?: AbortSignal;
}

export interface ProductionPlanContext {
  workspace: string;
  bundleId: string;
}

/** Resolve the canonical Project Profile reference behind a confirmed plan. */
export function loadProductionPlanContext(
  plan: TestPlan,
  storeRoot: string,
  fallbackWorkspace: string,
): ProductionPlanContext {
  const profileMatch = /^projects\/([a-f0-9]{64})\/project-profile\.json$/.exec(
    plan.projectProfileRef,
  );
  if (!profileMatch?.[1]) {
    throw new Error(
      'project_profile_ref_invalid: TestPlan has an invalid Project Profile reference',
    );
  }
  const profile = loadProfile(profileMatch[1], { dataRoot: storeRoot });
  if (!profile?.app.bundleId) {
    throw new Error('project_profile_bundle_missing: Project Profile has no confirmed bundleId');
  }
  const projectContainer = profile.app.workspace ?? profile.app.project;
  return {
    bundleId: profile.app.bundleId,
    workspace: projectContainer ? dirname(projectContainer) : fallbackWorkspace,
  };
}

function destinationFor(device: DeviceInfo) {
  return device.targetKind === 'physical'
    ? ({ targetKind: 'physical', udid: device.udid } as const)
    : ({ targetKind: 'simulator', simulatorId: device.udid } as const);
}

export function productionPermissionActions(
  plan: TestPlan,
  preparesWda = false,
): readonly string[] {
  if (plan.execution.resolvedPath === 'xcuitest') {
    return ['execute_project_build', 'replace_device_app'];
  }
  return preparesWda ? ['prepare_wda'] : [];
}

/** Shared production execution used by standalone rerun and interactive sessions. */
export async function executeProductionTestPlan(
  input: ProductionRunExecutorInput,
): Promise<ConfirmedExecutionDispatchResult & { runDir: string }> {
  if (input.plan.rerun && input.plan.execution.resolvedPath === 'device_backend') {
    throw new Error(
      'rerun_case_not_reproducible: DeviceBackend exploration cases are not replayable; save a confirmed Flow and use `itestagent run flow <flowId>`',
    );
  }
  const highRiskActions = productionPermissionActions(input.plan, input.preparesWda);
  for (const action of highRiskActions) {
    if (!(await input.authorize(action, `${input.bundleId}@${input.device.udid}`))) {
      const blocked: ConfirmedExecutionDispatchResult = {
        status: 'blocked',
        path: input.plan.execution.resolvedPath,
        error: `permission_denied: ${action}`,
        fallbackHistory: [],
      };
      const committed = await persistConfirmedRun({
        store: input.store,
        plan: input.plan,
        parentResult: input.parentResult,
        device: input.device,
        dispatch: blocked,
        resultBundlePath: join(
          input.storeRoot,
          'runs',
          input.plan.runId,
          'staging',
          'tests.xcresult',
        ),
      });
      return { ...blocked, runDir: committed.runDir };
    }
  }

  const stagingDir = join(input.storeRoot, 'runs', input.plan.runId, 'staging');
  const resultBundlePath = join(stagingDir, 'tests.xcresult');
  if (input.plan.execution.resolvedPath === 'xcuitest') {
    mkdirSync(dirname(resultBundlePath), { recursive: true });
  }
  const production = input.production ?? createProductionAgentSessionDependencies();
  const dispatcher = createProductionDualExecutionDispatcher(async ({ plan }) => {
    const backend = production.createDeviceBackend(input.device);
    let result: Awaited<ReturnType<typeof runRealDeviceExploration>>;
    try {
      result = await runRealDeviceExploration({
        backend,
        toolDispatcher: createBackendToolDispatcher(backend, input.signal),
        runDir: stagingDir,
        runId: plan.runId,
        bundleId: input.bundleId,
        deviceId: input.device.udid,
        targetKind: input.device.targetKind,
        dynamicActions: {
          cases: plan.rerun?.selectedCaseIds ?? plan.execution.features,
          suggest: input.suggest,
          authorizeSensitiveAction: ({ action, resource }) => input.authorize(action, resource),
        },
        policy: plan.execution.assertion.policy,
        signal: input.signal,
      });
    } catch (executionError) {
      const cleanup = await production.closeDeviceBackend?.(backend, input.signal);
      if (cleanup && !cleanup.reusable) {
        throw new DeviceBackendCleanupError(
          `backend_execution_and_cleanup_failed: ${executionError instanceof Error ? executionError.message : String(executionError)}; cleanup ${cleanup.status}: ${cleanup.issues.join('; ') || 'backend is terminal'}`,
          undefined,
          cleanup,
        );
      }
      throw executionError;
    }
    const cleanup = await production.closeDeviceBackend?.(backend, input.signal);
    if (cleanup && !cleanup.reusable) {
      throw new DeviceBackendCleanupError(
        `backend_cleanup_incomplete: ${cleanup.status}: ${cleanup.issues.join('; ') || 'backend is terminal'}`,
        result,
        cleanup,
      );
    }
    return result;
  });
  try {
    const dispatch = await dispatcher.dispatch({
      plan: input.plan,
      confirmed: true,
      workspace: input.workspace,
      destination: destinationFor(input.device),
      resultBundlePath,
      signal: input.signal,
    });
    const committed = await persistConfirmedRun({
      store: input.store,
      plan: input.plan,
      parentResult: input.parentResult,
      device: input.device,
      dispatch,
      resultBundlePath,
    });
    return { ...dispatch, runDir: committed.runDir };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function selectPlanDevice(plan: TestPlan, devices: readonly DeviceInfo[]): DeviceInfo {
  let candidates = devices.filter(
    (device) =>
      device.targetKind === plan.device.kind &&
      (device.targetKind === 'physical' || device.state === 'booted'),
  );
  const selector = plan.device.kind === 'physical' ? plan.device.physical : plan.device.simulator;
  if (selector?.selector === 'by_udid') {
    candidates = candidates.filter((device) => device.udid === selector.udid);
  } else if (selector?.selector === 'by_name') {
    candidates = candidates.filter((device) => device.name === selector.name);
  } else if (selector?.selector === 'create_from_profile') {
    candidates = [];
  }
  if (candidates.length !== 1) {
    throw new Error(
      `no_device_available: expected one ready ${plan.device.kind} target matching the confirmed selector, found ${candidates.length}`,
    );
  }
  return candidates[0] as DeviceInfo;
}
