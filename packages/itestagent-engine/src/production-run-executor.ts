import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type {
  BackendCleanupOutcome,
  DeviceBackend,
  DeviceInfo,
  PerformanceCapture,
  PerformanceCaptureFactory,
  PerformanceCaptureResult,
  RunResult,
  RunStatus,
  TestPlan,
  UserAssertion,
} from 'itestagent-contracts';
import { PerformanceCaptureStartError } from 'itestagent-contracts';
import { loadProfile } from 'itestagent-project-analyzer';
import type { RunStore } from 'itestagent-store';
import {
  createBaselineStore,
  createDefaultRunStore,
  createStoreCore,
  initStore,
  resolveStoreRoot,
} from 'itestagent-store';
import { persistConfirmedRun } from './confirmed-run-bundle.js';
import {
  type ConfirmedExecutionDispatchResult,
  DeviceBackendCleanupError,
  DeviceBackendExecutionError,
} from './dual-execution-dispatcher.js';
import type { PerformanceObservationContext } from './exploration/action-suggestion.js';
import { assertProviderUrl } from './exploration/assertion-suggester.js';
import {
  type ExplorationAction,
  type RealDeviceRunProgress,
  createBackendToolDispatcher,
  runRealDeviceExploration,
  suggestExplorationAction,
} from './exploration/index.js';
import { loadReviewedMemoryFlow, runMemoryRounds } from './memory-rounds.js';
import {
  type ProductionAgentSessionDependencies,
  type ProductionExecutionTransports,
  createProductionAgentSessionDependencies,
  createProductionDualExecutionDispatcher,
} from './production-agent-session.js';
import type { ProductionPhysicalPreflightProgress } from './production-physical-preflight.js';

export type ProductionActionSuggestion = (input: {
  caseId: string;
  goal: string;
  assertions: readonly UserAssertion[];
  performanceObservation?: PerformanceObservationContext;
  uiTree: string;
  history: readonly import('itestagent-contracts').RunStep[];
  signal?: AbortSignal;
  onProgress?: (progress: RealDeviceRunProgress) => void;
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
  return ({
    caseId,
    goal,
    assertions,
    performanceObservation,
    uiTree,
    history,
    signal,
    onProgress,
  }) =>
    suggestExplorationAction({
      generate: async (prompt, runSignal) =>
        (await generateText({ model, prompt, abortSignal: runSignal })).text,
      caseId,
      goal,
      assertions,
      performanceObservation,
      uiTree,
      history,
      signal,
      onProgress,
    });
}

export interface ProductionRunExecutorInput {
  plan: TestPlan;
  parentResult?: RunResult;
  workspace: string;
  device: DeviceInfo;
  bundleId: string;
  /** Confirmed application scheme from the Project Profile. */
  scheme?: string;
  store: RunStore;
  storeRoot: string;
  suggest: ProductionActionSuggestion;
  authorize(action: string, resource: string, signal?: AbortSignal): Promise<boolean>;
  /** True when this invocation will build, sign, or launch a managed WDA. */
  preparesWda?: boolean;
  /** Injectable production adapters for deterministic transport tests. */
  production?: ProductionAgentSessionDependencies;
  /** Injectable external transport boundaries; orchestration and persistence remain production. */
  transports?: ProductionExecutionTransports;
  createPerformanceCapture?: PerformanceCaptureFactory;
  signal?: AbortSignal;
  /** Non-sensitive lifecycle updates for the TUI or another interactive caller. */
  onProgress?: (progress: ProductionRunProgress) => void;
}

export interface ProductionRunProgress {
  readonly stage:
    | RealDeviceRunProgress['stage']
    | 'preparing_store'
    | 'preparing_route'
    | 'running_xcuitest'
    | 'connecting_device'
    | 'collecting_performance'
    | ProductionPhysicalPreflightProgress['stage']
    | 'cleaning_up'
    | 'saving_result';
  readonly message: string;
}

export interface ProductionPlanContext {
  workspace: string;
  bundleId: string;
  scheme?: string;
}

/** Resolve the canonical Project Profile reference behind a confirmed plan. */
export function loadProductionPlanContext(
  plan: TestPlan,
  storeRoot: string,
  fallbackWorkspace: string,
): ProductionPlanContext {
  const profileMatch =
    /^(?:~\/\.itestagent\/)?projects\/([a-f0-9]{64})\/project-profile\.json$/.exec(
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
    ...(profile.app.scheme ? { scheme: profile.app.scheme } : {}),
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
  if (plan.device.kind === 'simulator') return preparesWda ? ['prepare_wda'] : [];
  return [
    ...(plan.appSource.strategy === 'auto_from_workspace' ? ['execute_project_build'] : []),
    'replace_device_app',
    ...(preparesWda ? ['prepare_wda'] : []),
  ];
}

/** Shared production execution used by standalone rerun and interactive sessions. */
export async function executeProductionTestPlan(
  input: ProductionRunExecutorInput,
): Promise<ConfirmedExecutionDispatchResult & { runDir: string; runStatus: RunStatus }> {
  if (input.plan.rerun && input.plan.execution.resolvedPath === 'device_backend') {
    throw new Error(
      'rerun_case_not_reproducible: DeviceBackend exploration cases are not replayable; save a confirmed Flow and use `itestagent run flow <flowId>`',
    );
  }
  if (
    input.plan.execution.resolvedPath === 'device_backend' &&
    !input.plan.execution.goal?.trim()
  ) {
    throw new Error(
      'execution_goal_missing: this legacy TestPlan has no confirmed execution goal; create and confirm a new plan',
    );
  }
  const roundConfig = input.plan.performance.memoryRounds;
  const reviewedFlow = roundConfig
    ? await loadReviewedMemoryFlow(roundConfig, input.workspace, input.storeRoot)
    : undefined;
  if (
    roundConfig &&
    (input.plan.device.kind !== 'physical' ||
      input.plan.execution.resolvedPath !== 'device_backend' ||
      !input.createPerformanceCapture)
  )
    throw new Error('memory_rounds.route_or_capture_unsupported');
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
      return { ...blocked, ...committed };
    }
  }

  const stagingDir = join(input.storeRoot, 'runs', input.plan.runId, 'staging');
  const resultBundlePath = join(stagingDir, 'tests.xcresult');
  input.onProgress?.({
    stage: 'preparing_route',
    message: `Preparing the confirmed ${input.plan.execution.resolvedPath} route…`,
  });
  if (input.plan.execution.resolvedPath === 'xcuitest') {
    mkdirSync(dirname(resultBundlePath), { recursive: true });
  }
  const production = input.production ?? createProductionAgentSessionDependencies();
  let capture: PerformanceCapture | undefined;
  let performance: PerformanceCaptureResult | undefined;
  const requestedMetrics = input.plan.execution.metrics ?? [];
  const finishPerformance = async () => {
    if (!capture) return;
    try {
      performance = await capture.finish();
    } catch {
      performance = {
        artifacts: [],
        metrics: {
          collection: requestedMetrics.map((metric) => ({
            metric,
            status: input.signal?.aborted ? 'cancelled' : 'failed',
            reasonCode: 'performance.finalization_failed',
          })),
        },
      };
    }
    capture = undefined;
  };
  const closeBackend = async (
    backend: DeviceBackend,
  ): Promise<BackendCleanupOutcome | undefined> => {
    try {
      return await production.closeDeviceBackend?.(backend, input.signal);
    } catch {
      return {
        status: 'failed',
        reusable: false,
        issues: ['Device backend cleanup threw an error; the backend must not be reused.'],
      };
    }
  };
  const dispatcher = createProductionDualExecutionDispatcher(async ({ plan }) => {
    input.onProgress?.({
      stage: 'connecting_device',
      message: 'Connecting to the selected device…',
    });
    const backend = production.createDeviceBackend(input.device, {
      bundleId: input.bundleId,
      artifactDirectory: join(stagingDir, 'artifacts'),
    });
    let result: Awaited<ReturnType<typeof runRealDeviceExploration>>;
    let actionSignal = input.signal;
    try {
      if (input.device.targetKind === 'physical') {
        const physicalPreflight = production.physicalPreflight;
        if (!physicalPreflight) {
          throw new Error(
            'physical_preflight_unavailable: production composition has no physical preflight',
          );
        }
        const preflight = await physicalPreflight({
          plan,
          workspace: input.workspace,
          scheme: input.scheme,
          device: input.device,
          bundleId: input.bundleId,
          stagingDir,
          backend,
          authorize: input.authorize,
          signal: input.signal,
          onProgress: input.onProgress,
        });
        if (preflight.status !== 'ready') {
          throw new Error(`physical_preflight_${preflight.stage}: ${preflight.failure.message}`);
        }
        if (!roundConfig && requestedMetrics.some((metric) => metric !== 'test_duration')) {
          try {
            if (!input.createPerformanceCapture) throw new Error('performance.capture_unavailable');
            capture = await input.createPerformanceCapture({
              runId: plan.runId,
              deviceId: input.device.udid,
              targetKind: input.device.targetKind,
              executable: preflight.artifact.executable,
              stagingDir,
              metrics: requestedMetrics,
              memoryObservation: plan.performance.memoryObservation,
              signal: input.signal,
              onProgress: (message) =>
                input.onProgress?.({ stage: 'collecting_performance', message }),
            });
            actionSignal = capture.signal
              ? AbortSignal.any([capture.signal, ...(input.signal ? [input.signal] : [])])
              : input.signal;
            actionSignal?.throwIfAborted();
          } catch (error) {
            performance =
              error instanceof PerformanceCaptureStartError
                ? error.result
                : {
                    artifacts: [],
                    metrics: {
                      collection: requestedMetrics
                        .filter((metric) => metric !== 'test_duration')
                        .map((metric) => ({
                          metric,
                          status: input.signal?.aborted ? 'cancelled' : 'failed',
                          reasonCode: 'performance.recording_not_ready',
                        })),
                    },
                  };
            throw new Error('performance.preparation_failed');
          }
        }
      }
      if (
        input.device.targetKind === 'simulator' &&
        requestedMetrics.some((metric) => metric !== 'test_duration')
      ) {
        try {
          if (!input.createPerformanceCapture || !backend.getAppProcessId)
            throw new Error('native_memory.capture_unavailable');
          const launched = await backend.launchApp(
            { deviceId: input.device.udid, bundleId: input.bundleId },
            input.signal,
          );
          if (!launched.success) throw new Error('native_memory.launch_failed');
          const pid = await backend.getAppProcessId(
            { deviceId: input.device.udid, bundleId: input.bundleId },
            input.signal,
          );
          capture = await input.createPerformanceCapture({
            runId: plan.runId,
            deviceId: input.device.udid,
            targetKind: 'simulator',
            bundleId: input.bundleId,
            executable: String(pid),
            stagingDir,
            metrics: requestedMetrics,
            memoryObservation: plan.performance.memoryObservation,
            signal: input.signal,
            onProgress: (message) =>
              input.onProgress?.({ stage: 'collecting_performance', message }),
          });
          actionSignal = capture.signal
            ? AbortSignal.any([capture.signal, ...(input.signal ? [input.signal] : [])])
            : input.signal;
          actionSignal?.throwIfAborted();
        } catch (error) {
          performance =
            error instanceof PerformanceCaptureStartError
              ? error.result
              : {
                  artifacts: [],
                  metrics: {
                    collection: requestedMetrics
                      .filter((metric) => metric !== 'test_duration')
                      .map((metric) => ({
                        metric,
                        status: input.signal?.aborted ? 'cancelled' : 'failed',
                        reasonCode: 'native_memory.preparation_failed',
                      })),
                  },
                };
          throw new Error('native_memory.preparation_failed');
        }
      }
      if (roundConfig && reviewedFlow && input.createPerformanceCapture) {
        await loadReviewedMemoryFlow(roundConfig, input.workspace, input.storeRoot);
        const replay = await runMemoryRounds({
          plan,
          flow: reviewedFlow,
          backend,
          deviceId: input.device.udid,
          bundleId: input.bundleId,
          stagingDir,
          capture: input.createPerformanceCapture,
          authorize: input.authorize,
          signal: input.signal,
          progress: (message) => input.onProgress?.({ stage: 'collecting_performance', message }),
        });
        result = replay.result;
        performance = replay.performance;
      } else
        result = await runRealDeviceExploration({
          backend,
          toolDispatcher: createBackendToolDispatcher(backend, actionSignal),
          runDir: stagingDir,
          runId: plan.runId,
          bundleId: input.bundleId,
          deviceId: input.device.udid,
          targetKind: input.device.targetKind,
          dynamicActions: {
            cases: plan.rerun?.selectedCaseIds ?? plan.execution.features,
            suggest: ({ caseId, uiTree, history, signal }) =>
              input.suggest({
                caseId,
                goal: plan.execution.goal ?? '',
                assertions: (plan.execution.assertions ?? []).filter(
                  (assertion) => assertion.caseId === caseId,
                ),
                ...(plan.performance.memoryObservation
                  ? {
                      performanceObservation: {
                        ...plan.performance.memoryObservation,
                        captureStatus: capture ? ('started' as const) : ('unavailable' as const),
                      },
                    }
                  : {}),
                uiTree,
                history,
                signal,
                onProgress: input.onProgress,
              }),
            authorizeSensitiveAction: ({ action, resource }) => input.authorize(action, resource),
          },
          policy: plan.execution.assertion.policy,
          assertions: plan.execution.assertions,
          signal: actionSignal,
          onProgress: input.onProgress,
        });
    } catch (executionError) {
      await finishPerformance();
      input.onProgress?.({
        stage: 'cleaning_up',
        message: 'Execution stopped; cleaning up the device session…',
      });
      const cleanup = await closeBackend(backend);
      if (cleanup && !cleanup.reusable) {
        throw new DeviceBackendCleanupError(
          `backend_execution_and_cleanup_failed: ${executionError instanceof Error ? executionError.message : String(executionError)}; cleanup ${cleanup.status}: ${cleanup.issues.join('; ') || 'backend is terminal'}`,
          executionError instanceof DeviceBackendExecutionError
            ? executionError.partialResult
            : undefined,
          cleanup,
        );
      }
      throw executionError;
    }
    await finishPerformance();
    input.onProgress?.({
      stage: 'cleaning_up',
      message: 'Cleaning up the device session…',
    });
    const cleanup = await closeBackend(backend);
    if (cleanup && !cleanup.reusable) {
      throw new DeviceBackendCleanupError(
        `backend_cleanup_incomplete: ${cleanup.status}: ${cleanup.issues.join('; ') || 'backend is terminal'}`,
        result,
        cleanup,
      );
    }
    if (actionSignal?.aborted) {
      throw new DeviceBackendExecutionError(
        input.signal?.aborted ? 'performance.cancelled' : 'performance.capture_failed',
        result,
      );
    }
    return result;
  }, input.transports);
  try {
    if (input.plan.execution.resolvedPath === 'xcuitest') {
      input.onProgress?.({
        stage: 'running_xcuitest',
        message: 'Running the confirmed XCUITest selection…',
      });
    }
    const dispatch = await dispatcher.dispatch({
      plan: input.plan,
      confirmed: true,
      workspace: input.workspace,
      destination: destinationFor(input.device),
      resultBundlePath,
      signal: input.signal,
    });
    input.onProgress?.({
      stage: 'saving_result',
      message: `Saving the ${dispatch.status} run result and evidence index…`,
    });
    const committed = await persistConfirmedRun({
      store: input.store,
      plan: input.plan,
      parentResult: input.parentResult,
      device: input.device,
      dispatch,
      resultBundlePath,
      performance,
      baselineStore: createBaselineStore(input.storeRoot),
      onBaselineWarning: () =>
        input.onProgress?.({
          stage: 'saving_result',
          message: 'Memory baseline storage unavailable; no comparison or update is claimed.',
        }),
    });
    return { ...dispatch, ...committed };
  } finally {
    await finishPerformance();
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

/** Default-store production entry used by the interactive TUI composition root. */
export async function executeProductionTestPlanToDefaultStore(
  input: Omit<ProductionRunExecutorInput, 'store' | 'storeRoot'>,
): Promise<ConfirmedExecutionDispatchResult & { runDir: string; runStatus: RunStatus }> {
  input.onProgress?.({
    stage: 'preparing_store',
    message: 'Preparing local run storage…',
  });
  const storeRoot = initStore(resolveStoreRoot());
  const core = createStoreCore(join(storeRoot, 'db', 'itestagent.db'));
  await core.driver.migrate();
  return executeProductionTestPlan({
    ...input,
    store: createDefaultRunStore(core.db),
    storeRoot,
  });
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
