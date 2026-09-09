import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { type LanguageModel, generateText } from 'ai';
import { createProductionPerformanceCapture } from 'itestagent-backends-performance-xctrace-analyzer';
import type {
  AgentEvent,
  DeviceBackend,
  DeviceDiscoverySnapshot,
  DeviceInfo,
  PerformanceCaptureFactory,
  RunStatus,
  TargetKind,
  TestPlan,
  ToolCall,
  ToolResult,
} from 'itestagent-contracts';
import { RunStatusSchema } from 'itestagent-contracts';
import {
  AiSdkAgentRuntime,
  BackendRegistry,
  BackendSelector,
  type BaselineAcceptanceDependencies,
  PermissionEngine,
  PlanningSession,
  type ProductionActionSuggestion,
  type ProductionAgentSessionDependencies,
  type ProductionExecutionTransports,
  type SimulatorAppiumOptions,
  ToolDispatcher,
  assertProviderUrl,
  createDefaultMemoryBaselineAcceptance,
  createMemoryBaselineAcceptance,
  createProductionAgentSessionDependencies,
  executeProductionTestPlanToDefaultStore,
  prepareMemoryRounds,
  productionPermissionActions,
  simulatorConnectionSummary,
  suggestExplorationAction,
  validateSimulatorAppiumOptions,
} from 'itestagent-engine';
import type { CandidateLink, ProjectAnalysisResult } from 'itestagent-project-analyzer';
import { isDeviceReady } from './device-review.js';
import { persistGlobalDeniedRule } from './global-deny-store.js';
import { retainMessages } from './message-retention.js';
import {
  DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_MODEL,
  sanitizeProviderErrorMessage,
} from './provider-validation.js';
import { loadTuiRuntimeConfig } from './runtime-config.js';

interface SessionConfig {
  baseURL?: string;
  model?: string;
}

interface CommittedRunNotice {
  runId: string;
  runDir: string;
  runStatus?: RunStatus;
}

function reportLocationNotice(committedRun: { runDir: string; runId: string } | null): string {
  if (!committedRun) return 'No report was saved for this execution.';
  return [
    `Report directory: ${committedRun.runDir}`,
    `Summary: ${join(committedRun.runDir, 'summary.md')}`,
    `Evidence directory: ${join(committedRun.runDir, 'artifacts')}`,
    `Review a memory baseline replacement: /baseline accept ${committedRun.runId}`,
  ].join('\n');
}

async function loadApiKey(): Promise<string | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'itestagent/openai_api_key', '-a', 'itestagent', '-w'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    let settled = false;

    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolvePromise(value);
    };

    const timer = setTimeout(() => settle(null), 5000);
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      settle(code === 0 ? Buffer.concat(chunks).toString('utf-8').trim() : null);
    });
    child.on('error', () => {
      clearTimeout(timer);
      settle(null);
    });
  });
}

export const AGENT_TOOLS: Record<
  string,
  { description: string; parameters: Record<string, unknown> }
> = {
  analyzeProject: {
    description:
      'Analyze the current iOS workspace with the configured project analyzer. Returns a project profile plus explicit analysis tier, capabilities, and limitations.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  getDeviceInfo: {
    description:
      'Discover connected iPhone devices and local iOS Simulators. The result is observed state, not a guessed connection status.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  compileTestPlan: {
    description:
      'Return the proposed TestPlan compiled from the current intent and explicitly confirmed project candidates.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  executeTestPlan: {
    description:
      'Dispatch a user-confirmed test plan to its pre-resolved XCUITest or DeviceBackend route on an explicitly selected target.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  generateReport: {
    description:
      'Generate the report triplet from real run evidence. This capability may report that its owning task is not wired yet.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

function buildSystemPrompt(workspace: string): string {
  return `You are iTestAgent, a local iOS testing assistant.

Current workspace: ${workspace}

Use tools for project and device facts. Project source findings are candidates with evidence and confidence until the user confirms them. Before execution, present the proposed test plan and obtain explicit confirmation. If a capability reports capability_not_wired, explain the blocked owner task and do not claim success. Never fabricate device state, execution evidence, metrics, or reports. Keep physical-device and Simulator targets explicit and never silently switch between them.`;
}

export type AgentDeviceDiscovery = DeviceDiscoverySnapshot;

function normalizeDiscovery(value: AgentDeviceDiscovery | DeviceInfo[]): AgentDeviceDiscovery {
  return Array.isArray(value) ? { devices: value, status: 'ok', issues: [] } : value;
}

export function selectConfirmedPlanDevice(
  plan: TestPlan,
  devices: readonly DeviceInfo[],
): DeviceInfo {
  let candidates = devices.filter(
    (device) => device.targetKind === plan.device.kind && isDeviceReady(device),
  );
  if (plan.device.kind === 'physical') {
    const selector = plan.device.physical;
    if (selector?.selector === 'by_udid') {
      candidates = candidates.filter((device) => device.udid === selector.udid);
    } else if (selector?.selector === 'by_name') {
      candidates = candidates.filter((device) => device.name === selector.name);
    }
  } else {
    const selector = plan.device.simulator;
    if (selector?.selector === 'by_udid') {
      candidates = candidates.filter((device) => device.udid === selector.udid);
    } else if (selector?.selector === 'by_name') {
      candidates = candidates.filter((device) => device.name === selector.name);
    } else if (selector?.selector === 'create_from_profile') {
      candidates = [];
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      `no_device_available: no ready ${plan.device.kind} target matches the confirmed selector`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `device_selection_required: ${candidates.length} ${plan.device.kind} targets match the confirmed selector`,
    );
  }
  return candidates[0] as DeviceInfo;
}

export interface AgentSessionDependencies {
  /** Validated transient CLI settings, applied only by the real Simulator composition. */
  simulatorAppium?: SimulatorAppiumOptions;
  baselineAcceptance?: BaselineAcceptanceDependencies;
  /** Alternate local Flow root for isolated transport tests. */
  flowDataRoot?: string;
  loadApiKey?: () => Promise<string | null>;
  createModel?: (config: SessionConfig, apiKey: string) => LanguageModel;
  analyzeWorkspace?: (workspace: string) => Promise<ProjectAnalysisResult>;
  listDevices?: () => Promise<AgentDeviceDiscovery | DeviceInfo[]>;
  /** Injectable delay used by the explicit device-refresh settling probe. */
  waitForDeviceRefresh?: (delayMs: number) => Promise<void>;
  /** Injectable ask deadline; production uses the PermissionEngine default. */
  permissionAskTimeoutMs?: number;
  createDeviceBackend?: (device: DeviceInfo) => DeviceBackend;
  closeDeviceBackend?: ProductionAgentSessionDependencies['closeDeviceBackend'];
  /** Full production composition; tests should replace only its external transport boundaries. */
  production?: ProductionAgentSessionDependencies;
  createPerformanceCapture?: PerformanceCaptureFactory;
  /** Route-derived WDA lifecycle fact for an explicitly supplied DeviceBackend. */
  preparesWda?: (device: DeviceInfo) => boolean;
  transports?: ProductionExecutionTransports;
  /** Model suggestion boundary only; the production exploration loop remains active. */
  suggestExplorationAction?: ProductionActionSuggestion;
  executeConfirmedPlan?: (input: {
    plan: TestPlan;
    workspace: string;
    device: DeviceInfo;
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
  }) => Promise<unknown>;
}

export interface TuiAgentSession {
  processMessage(input: string): AsyncIterable<TuiStatePatch>;
  getDevices(): readonly DeviceInfo[];
  confirmCandidates(candidates: readonly CandidateLink[]): readonly TuiStatePatch[];
  selectDevice(
    udid: string,
    switchDecision?: { token: string; allow: boolean },
  ): Promise<readonly TuiStatePatch[]>;
  refreshDevices(): Promise<readonly TuiStatePatch[]>;
  modifyPlan(input: string): readonly TuiStatePatch[];
  configureMemoryRounds?(input: string): Promise<readonly TuiStatePatch[]>;
  confirmPlan(): readonly TuiStatePatch[];
  executeConfirmedPlan(): AsyncIterable<TuiStatePatch>;
  cancelPlan(): readonly TuiStatePatch[];
  getConfirmedPlan(): TestPlan | null;
  resolvePermission(callId: string, effect: 'allow' | 'deny', remember?: boolean): Promise<void>;
  cancelPermission(callId: string, reason?: string): void;
  dispose(): void;
}

const NEW_PLAN_COMMAND = '/plan';

function explicitPlanGoal(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === NEW_PLAN_COMMAND) {
    throw new Error('planning_goal_required: use /plan <test goal>');
  }
  if (!trimmed.startsWith(`${NEW_PLAN_COMMAND} `)) return null;
  const goal = trimmed.slice(NEW_PLAN_COMMAND.length).trim();
  if (!goal) throw new Error('planning_goal_required: use /plan <test goal>');
  return goal;
}

export interface TuiStatePatch {
  type:
    | 'message_add'
    | 'message_update'
    | 'planning_reset'
    | 'mode_change'
    | 'intent_update'
    | 'candidates_update'
    | 'device_selection_request'
    | 'device_target_switch_request'
    | 'device_selected'
    | 'plan_update'
    | 'permission_request'
    | 'permission_resolved'
    | 'devices_update'
    | 'activity_update'
    | 'error';
  payload: Record<string, unknown>;
}

class PatchQueue implements AsyncIterable<TuiStatePatch> {
  private readonly values: TuiStatePatch[] = [];
  private readonly waiters: Array<(result: IteratorResult<TuiStatePatch>) => void> = [];
  private closed = false;

  push(value: TuiStatePatch): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<TuiStatePatch> {
    return {
      next: async (): Promise<IteratorResult<TuiStatePatch>> => {
        const value = this.values.shift();
        if (value) return { value, done: false };
        if (this.closed) return { value: undefined, done: true };
        return new Promise((resolveNext) => this.waiters.push(resolveNext));
      },
    };
  }
}

interface ActivePatchQueue {
  readonly owner: symbol;
  readonly queue: PatchQueue;
}

export async function createAgentSession(
  workspace: string,
  dependencies: AgentSessionDependencies = {},
): Promise<TuiAgentSession> {
  const simulatorAppium = dependencies.simulatorAppium
    ? validateSimulatorAppiumOptions(dependencies.simulatorAppium)
    : undefined;
  const production =
    dependencies.production ?? createProductionAgentSessionDependencies({ simulatorAppium });
  const runtimeConfig = loadTuiRuntimeConfig({ workspace });
  const config: SessionConfig = {
    baseURL: runtimeConfig.model.baseURL ?? DEFAULT_PROVIDER_BASE_URL,
    model: runtimeConfig.model.model ?? DEFAULT_PROVIDER_MODEL,
  };
  assertProviderUrl(config.baseURL ?? DEFAULT_PROVIDER_BASE_URL);
  const apiKey = await (dependencies.loadApiKey ?? loadApiKey)();
  if (!apiKey) {
    throw new Error(
      'No API key found. Store it in Keychain: security add-generic-password -s itestagent/openai_api_key -a itestagent -w',
    );
  }

  const model = dependencies.createModel
    ? dependencies.createModel(config, apiKey)
    : createOpenAI({
        baseURL: config.baseURL ?? DEFAULT_PROVIDER_BASE_URL,
        apiKey,
      }).chat(config.model ?? DEFAULT_PROVIDER_MODEL);

  const analyzeWorkspace = dependencies.analyzeWorkspace ?? production.analyzeWorkspace;
  const listDevices = dependencies.listDevices ?? (() => production.deviceDiscovery.discover());
  const preparesWda =
    dependencies.preparesWda ??
    (dependencies.createDeviceBackend ? () => false : (production.preparesWda ?? (() => false)));
  let discovery = normalizeDiscovery(await listDevices());
  let devices = discovery.devices;
  let selectedDeviceUdid: string | null = null;
  const waitForDeviceRefresh =
    dependencies.waitForDeviceRefresh ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let refreshTail: Promise<void> = Promise.resolve();
  const refreshDiscovery = () => {
    const refresh = refreshTail.then(async () => {
      const nextDiscovery = normalizeDiscovery(await listDevices());
      discovery = nextDiscovery;
      devices = nextDiscovery.devices;
      if (
        selectedDeviceUdid &&
        !devices.some((device) => device.udid === selectedDeviceUdid && isDeviceReady(device))
      ) {
        selectedDeviceUdid = null;
      }
      return nextDiscovery;
    });
    // A failed probe must not poison later user-requested refreshes.
    refreshTail = refresh.then(
      () => undefined,
      () => undefined,
    );
    return refresh;
  };

  const targetKindForCurrentPlan = (): TargetKind | null =>
    planningSession?.getSnapshot().plan?.device.kind ?? null;

  const refreshUntilTargetSettles = async (selectedUdid?: string, requestedKind?: TargetKind) => {
    await refreshDiscovery();
    const targetKind = requestedKind ?? targetKindForCurrentPlan();
    if (!targetKind) return;
    for (const delayMs of [250, 750, 1_500]) {
      if (
        devices.some(
          (device) =>
            device.targetKind === targetKind &&
            (!selectedUdid || device.udid === selectedUdid) &&
            isDeviceReady(device),
        )
      ) {
        return;
      }
      await waitForDeviceRefresh(delayMs);
      await refreshDiscovery();
    }
  };

  const permissionEngine = new PermissionEngine({
    preloadedRules: runtimeConfig.permissions.deniedRules,
    askTimeoutMs: dependencies.permissionAskTimeoutMs,
  });
  const pendingPermissionIds = new Set<string>();
  const pendingPermissions = new Map<string, { action: string; resource: string }>();
  let activeQueue: ActivePatchQueue | null = null;
  let activeTurn = false;
  let activeDirectExecutionAbort: AbortController | null = null;
  let discoveryNoticeEmitted = false;
  let planningSession: PlanningSession | null = null;
  let deviceSelectionRevision = 0;
  let pendingTargetSwitch: {
    token: string;
    udid: string;
    kind: TargetKind;
    session: PlanningSession;
    plan: string;
  } | null = null;
  let cachedAnalysis: ProjectAnalysisResult | null = null;
  const transcript: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const analyzeOnce = async (): Promise<ProjectAnalysisResult> => {
    if (!cachedAnalysis) cachedAnalysis = await analyzeWorkspace(workspace);
    return cachedAnalysis;
  };
  let latestCommittedRun: CommittedRunNotice | null = null;
  const getLatestCommittedRun = (): CommittedRunNotice | null => latestCommittedRun;
  let activeExecutionActivityId: string | null = null;

  const confirmedExecutionContext = () => {
    const plan = planningSession?.getConfirmedPlan();
    if (!plan) {
      throw new Error(
        'plan_confirmation_required: confirm the displayed TestPlan before execution',
      );
    }
    const device = selectConfirmedPlanDevice(plan, devices);
    const bundleId = cachedAnalysis?.profile.app.bundleId;
    if (!bundleId) {
      throw new Error('execution_blocked: project profile has no confirmed bundleId');
    }
    const resource = `${bundleId}@${device.udid}`;
    const actions = [...productionPermissionActions(plan, preparesWda(device))];
    return { plan, device, bundleId, resource, actions };
  };

  const executeConfirmedPlan =
    dependencies.executeConfirmedPlan ??
    (async ({ plan, workspace: executionWorkspace, device, signal, onProgress }) => {
      const analysis = await analyzeOnce();
      const bundleId = analysis.profile.app.bundleId;
      if (!bundleId) {
        throw new Error('execution_blocked: project profile has no confirmed bundleId');
      }
      const executionContext = confirmedExecutionContext();
      if (
        executionContext.plan.runId !== plan.runId ||
        executionContext.device.udid !== device.udid
      ) {
        throw new Error(
          'execution_context_changed: confirmed plan or device changed after authorization',
        );
      }
      const authorizedByExecutionTool = new Set(
        executionContext.actions.map((action) => `${action}\u0000${executionContext.resource}`),
      );
      const executed = await executeProductionTestPlanToDefaultStore({
        plan,
        workspace: executionWorkspace,
        device,
        bundleId,
        ...(analysis.profile.app.scheme ? { scheme: analysis.profile.app.scheme } : {}),
        preparesWda: preparesWda(device),
        suggest:
          dependencies.suggestExplorationAction ??
          (({
            caseId,
            goal,
            assertions,
            performanceObservation,
            uiTree,
            history,
            signal: suggestionSignal,
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
              signal: suggestionSignal,
              onProgress,
            })),
        authorize: (action, resource, permissionSignal = signal) =>
          authorizedByExecutionTool.has(`${action}\u0000${resource}`)
            ? Promise.resolve(true)
            : toolDispatcher.authorize(
                `execution-${crypto.randomUUID()}`,
                action,
                resource,
                permissionSignal,
              ),
        production: {
          analyzeWorkspace,
          deviceDiscovery: production.deviceDiscovery,
          createDeviceBackend: dependencies.createDeviceBackend ?? production.createDeviceBackend,
          physicalPreflight: production.physicalPreflight,
          closeDeviceBackend: dependencies.closeDeviceBackend ?? production.closeDeviceBackend,
        },
        transports: dependencies.transports,
        createPerformanceCapture:
          dependencies.createPerformanceCapture ??
          (dependencies.production || dependencies.createDeviceBackend
            ? undefined
            : createProductionPerformanceCapture()),
        signal,
        onProgress: ({ message }) => onProgress?.(message),
      });
      return executed;
    });

  const toolDispatcher = new ToolDispatcher({
    permissionEngine,
    backendSelector: new BackendSelector(new BackendRegistry()),
    targetKind: 'physical',
    customTools: {
      analyzeProject: {
        action: 'analyze_project',
        resource: `workspace:${workspace}`,
        backendName: 'itestagent-project-analyzer',
        execute: () => analyzeOnce(),
      },
      getDeviceInfo: {
        action: 'list_devices',
        resource: 'local-apple-devices',
        backendName: 'itestagent-backends-device-appium',
        execute: async () => {
          await refreshDiscovery();
          activeQueue?.queue.push({
            type: 'devices_update',
            payload: {
              devices,
              discoveryStatus: discovery.status,
              issues: discovery.issues,
              targetKind: targetKindForCurrentPlan(),
            },
          });
          if (discovery.issues.length > 0) {
            activeQueue?.queue.push({
              type: 'message_add',
              payload: {
                role: 'system',
                text: `Device discovery ${discovery.status}: ${discovery.issues.map((issue) => `${issue.lane}: ${issue.message}`).join('; ')}`,
              },
            });
          }
          const targetKind = targetKindForCurrentPlan();
          const targetDevices = targetKind
            ? devices.filter((device) => device.targetKind === targetKind)
            : devices;
          const selectedDevice =
            devices.find((device) => device.udid === selectedDeviceUdid && isDeviceReady(device)) ??
            null;
          return {
            targetKind,
            ready: targetDevices.some(isDeviceReady),
            selectedDevice: selectedDevice ? summarizeDeviceForModel(selectedDevice) : null,
            devices: targetDevices.map(summarizeDeviceForModel),
            discoveryStatus: discovery.status,
            limitations: discovery.issues,
          };
        },
      },
      compileTestPlan: {
        // Compiling the in-memory TestPlan is not US-20 test-code generation.
        action: 'compile_test_plan',
        resource: `workspace:${workspace}`,
        backendName: 'itestagent-engine',
        execute: async () => {
          const snapshot = planningSession?.getSnapshot();
          if (!snapshot?.plan) {
            throw new Error(
              'candidate_confirmation_required: review and confirm project candidates in the TUI before compiling a TestPlan',
            );
          }
          return { status: snapshot.status, plan: snapshot.plan };
        },
      },
      executeTestPlan: {
        action: () => confirmedExecutionContext().actions[0] ?? 'execute_confirmed_test_plan',
        additionalActions: () => confirmedExecutionContext().actions.slice(1),
        resource: () => confirmedExecutionContext().resource,
        backendName: 'itestagent-engine',
        execute: async (_args, signal) => {
          const { plan, device } = confirmedExecutionContext();
          const result = await executeConfirmedPlan({
            plan,
            workspace,
            device,
            signal,
            onProgress: (message) => {
              if (!activeExecutionActivityId) return;
              activeQueue?.queue.push({
                type: 'activity_update',
                payload: { id: activeExecutionActivityId, text: message },
              });
            },
          });
          if (
            result &&
            typeof result === 'object' &&
            'runDir' in result &&
            typeof result.runDir === 'string' &&
            result.runDir.trim().length > 0
          ) {
            const runStatus = RunStatusSchema.safeParse(
              'runStatus' in result ? result.runStatus : undefined,
            );
            latestCommittedRun = {
              runId: plan.runId,
              runDir: resolve(result.runDir),
              ...(runStatus.success ? { runStatus: runStatus.data } : {}),
            };
          }
          return result;
        },
      },
      generateReport: {
        action: 'generate_report',
        resource: `workspace:${workspace}`,
        backendName: 'itestagent-report',
        execute: async () => {
          if (!latestCommittedRun) {
            throw new Error('report_unavailable: no confirmed execution has committed a report');
          }
          return { status: 'committed', ...latestCommittedRun };
        },
      },
    },
    onEvent: (event) => {
      if (event.type === 'tool.started' && event.name === 'executeTestPlan') {
        activeExecutionActivityId = event.callId;
      }
      if (
        (event.type === 'tool.completed' || event.type === 'tool.failed') &&
        event.callId === activeExecutionActivityId
      ) {
        activeExecutionActivityId = null;
      }
      if (event.type === 'permission.requested') {
        pendingPermissionIds.add(event.callId);
        pendingPermissions.set(event.callId, { action: event.action, resource: event.resource });
      }
      if (event.type === 'permission.resolved') {
        pendingPermissionIds.delete(event.callId);
        pendingPermissions.delete(event.callId);
      }
      if (
        event.type === 'permission.requested' ||
        event.type === 'permission.resolved' ||
        event.type === 'tool.started' ||
        event.type === 'tool.progress'
      ) {
        const patch = mapEventToPatch(event);
        if (patch) activeQueue?.queue.push(patch);
      }
    },
  });

  const acceptMemoryBaseline = dependencies.baselineAcceptance
    ? createMemoryBaselineAcceptance(dependencies.baselineAcceptance)
    : createDefaultMemoryBaselineAcceptance(workspace);

  const agentRuntime = new AiSdkAgentRuntime({
    model,
    tools: AGENT_TOOLS,
    toolExecutor: (call: ToolCall, signal?: AbortSignal): Promise<ToolResult> =>
      toolDispatcher.dispatch(call, signal),
    system: buildSystemPrompt(workspace),
    maxSteps: 15,
  });

  let disposed = false;
  let roundPreparationPending = false;
  const configureMemoryRounds = async (input: string): Promise<readonly TuiStatePatch[]> => {
    const match = /^\/memory-rounds\s+([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\s+(\d+)\s+(\d+)\s*$/.exec(
      input.trim(),
    );
    if (!match)
      throw new Error(
        'Usage in Plan Review: /memory-rounds <flow-id> <2-10 rounds> <0-60 interval seconds>',
      );
    const session = planningSession;
    const snapshot = session?.getSnapshot();
    if (
      disposed ||
      !session ||
      snapshot?.status !== 'awaiting_plan_confirmation' ||
      !snapshot.plan ||
      roundPreparationPending
    )
      throw new Error('memory_rounds.draft_required: configure rounds in a draft Plan Review');
    const identity = JSON.stringify(snapshot.plan);
    roundPreparationPending = true;
    try {
      const config = await prepareMemoryRounds(
        match[1] ?? '',
        Number(match[2]),
        Number(match[3]) * 1000,
        workspace,
        dependencies.flowDataRoot,
      );
      if (
        disposed ||
        session.getSnapshot().status !== 'awaiting_plan_confirmation' ||
        planningSession !== session ||
        JSON.stringify(session.getSnapshot().plan) !== identity
      )
        throw new Error('memory_rounds.draft_changed: review the current draft again');
      return planningPatches(session.configureMemoryRounds(config), devices, simulatorAppium);
    } finally {
      roundPreparationPending = false;
    }
  };

  return {
    configureMemoryRounds,
    processMessage(input: string): AsyncIterable<TuiStatePatch> {
      if (activeTurn) throw new Error('An agent turn is already in progress');
      activeTurn = true;
      const queue = new PatchQueue();
      const queueOwner = Symbol('agent-message');
      activeQueue = { owner: queueOwner, queue };
      queue.push({
        type: 'devices_update',
        payload: {
          devices,
          discoveryStatus: discovery.status,
          issues: discovery.issues,
        },
      });
      if (!discoveryNoticeEmitted && discovery.issues.length > 0) {
        discoveryNoticeEmitted = true;
        queue.push({
          type: 'message_add',
          payload: {
            role: 'system',
            text: `Device discovery ${discovery.status}: ${discovery.issues.map((issue) => `${issue.lane}: ${issue.message}`).join('; ')}`,
          },
        });
      }

      void (async () => {
        try {
          if (/^\/memory-rounds(?:\s|$)/.test(input.trim())) {
            for (const patch of await configureMemoryRounds(input)) queue.push(patch);
            return;
          }
          if (/^\/baseline(?:\s|$)/.test(input.trim())) {
            const match = /^\/baseline\s+accept\s+(\S+)\s*$/.exec(input.trim());
            if (!match) throw new Error('Usage: /baseline accept <run-id>');
            const controller = new AbortController();
            activeDirectExecutionAbort = controller;
            try {
              await acceptMemoryBaseline({
                runId: match[1] ?? '',
                permissionEngine,
                signal: controller.signal,
                preview: (text) =>
                  queue.push({ type: 'message_add', payload: { role: 'system', text } }),
                requested: (request) => {
                  pendingPermissionIds.add(request.callId);
                  pendingPermissions.set(request.callId, {
                    action: request.action,
                    resource: request.resource,
                  });
                  queue.push({
                    type: 'permission_request',
                    payload: { ...request, timeoutMs: permissionEngine.getAskTimeoutMs() },
                  });
                },
                resolved: (callId, effect, reason) => {
                  pendingPermissionIds.delete(callId);
                  pendingPermissions.delete(callId);
                  queue.push({ type: 'permission_resolved', payload: { callId, effect, reason } });
                  queue.push({ type: 'activity_update', payload: { complete: true, id: callId } });
                },
              });
              queue.push({
                type: 'message_add',
                payload: { role: 'system', text: `Memory baseline updated from ${match[1]}.` },
              });
            } finally {
              if (activeDirectExecutionAbort === controller) activeDirectExecutionAbort = null;
            }
            return;
          }
          const analysis = await analyzeOnce();
          const explicitGoal = explicitPlanGoal(input);
          let planningSnapshot = null;
          if (!planningSession || explicitGoal !== null) {
            planningSession = new PlanningSession(analysis);
            planningSnapshot = planningSession.begin(explicitGoal ?? input);
          } else if (planningSession.getSnapshot().status === 'awaiting_clarification') {
            planningSnapshot = planningSession.clarify(input);
          } else if (
            planningSession.getSnapshot().status === 'awaiting_execution_route_selection' ||
            planningSession.getSnapshot().status === 'execution_route_blocked'
          ) {
            planningSnapshot = planningSession.selectExecutionRouteFromInput(input);
          }
          if (planningSnapshot) {
            if (explicitGoal !== null) {
              selectedDeviceUdid = null;
              queue.push({ type: 'planning_reset', payload: {} });
            }
            for (const patch of planningPatches(planningSnapshot, devices, simulatorAppium))
              queue.push(patch);
          }

          transcript.push({ role: 'user', content: input });
          if (planningSnapshot && planningSnapshotNeedsUserInput(planningSnapshot.status)) {
            return;
          }
          let assistantText = '';
          for await (const event of agentRuntime.streamTurn({
            messages: retainSessionTranscript(transcript, 40),
          })) {
            if (event.type === 'assistant.delta') assistantText += event.delta;
            const patch = mapEventToPatch(event);
            if (patch) queue.push(patch);
          }
          if (assistantText) transcript.push({ role: 'assistant', content: assistantText });
        } catch (error: unknown) {
          queue.push({
            type: 'error',
            payload: { message: error instanceof Error ? error.message : String(error) },
          });
        } finally {
          activeTurn = false;
          if (activeQueue?.owner === queueOwner) activeQueue = null;
          queue.close();
        }
      })();

      return queue;
    },

    getDevices() {
      return [...devices];
    },

    confirmCandidates(candidates) {
      if (!planningSession) {
        throw new Error('planning_session_unavailable: submit a test goal first');
      }
      return planningPatches(
        planningSession.confirmCandidates(candidates),
        devices,
        simulatorAppium,
      );
    },

    async selectDevice(udid, switchDecision) {
      if (!planningSession) {
        throw new Error('planning_session_unavailable: submit a test goal first');
      }
      const session = planningSession;
      const initial = session.getSnapshot();
      const plan = initial.plan;
      if (!plan) throw new Error('plan_unavailable: there is no draft plan to update');
      if (initial.status !== 'awaiting_plan_confirmation')
        throw new Error('invalid_transition: device selection requires a draft plan');
      const revision = ++deviceSelectionRevision;
      const planIdentity = JSON.stringify(plan);
      const candidate = devices.find((device) => device.udid === udid);
      const pending = pendingTargetSwitch;
      pendingTargetSwitch = null;
      if (
        switchDecision &&
        (!pending ||
          pending.token !== switchDecision.token ||
          pending.udid !== udid ||
          pending.session !== session ||
          pending.plan !== planIdentity ||
          candidate?.targetKind !== pending.kind)
      ) {
        throw new Error(
          'target_switch_stale: select the device again to confirm a fresh target switch',
        );
      }
      if (switchDecision && !switchDecision.allow) {
        return [
          { type: 'device_selection_request', payload: { devices, targetKind: plan.device.kind } },
        ];
      }
      if (candidate && candidate.targetKind !== plan.device.kind && !switchDecision) {
        const token = crypto.randomUUID();
        pendingTargetSwitch = {
          token,
          udid,
          kind: candidate.targetKind,
          session,
          plan: planIdentity,
        };
        return [
          {
            type: 'device_target_switch_request',
            payload: {
              token,
              udid,
              name: candidate.name ?? 'Unnamed device',
              from: plan.device.kind,
              to: candidate.targetKind,
            },
          },
        ];
      }
      const selectedKind = candidate?.targetKind ?? plan.device.kind;
      await refreshUntilTargetSettles(udid, selectedKind);
      if (
        revision !== deviceSelectionRevision ||
        planningSession !== session ||
        session.getSnapshot().status !== 'awaiting_plan_confirmation' ||
        JSON.stringify(session.getSnapshot().plan) !== planIdentity
      )
        return [];
      const selected = devices.find(
        (device) =>
          device.udid === udid && device.targetKind === selectedKind && isDeviceReady(device),
      );
      if (!selected) {
        const snapshot = planningSession.getSnapshot();
        return [
          deviceUpdatePatch(plan.device.kind, devices, discovery),
          {
            type: 'device_selection_request',
            payload: { devices, targetKind: snapshot.plan?.device.kind ?? plan.device.kind },
          },
          {
            type: 'error',
            payload: {
              message: `device_not_ready: selected ${selectedKind} target is not ready after refresh; connect or boot it and press r to retry`,
            },
          },
        ];
      }
      const device =
        selected.targetKind === 'physical'
          ? {
              kind: 'physical' as const,
              physical: { selector: 'by_udid' as const, udid: selected.udid },
            }
          : {
              kind: 'simulator' as const,
              simulator: { selector: 'by_udid' as const, udid: selected.udid },
            };
      const snapshot =
        selectedKind === plan.device.kind
          ? session.selectDevice(device)
          : session.switchDeviceTarget(device);
      selectedDeviceUdid = snapshot.plan ? selected.udid : null;
      return [
        deviceUpdatePatch(selectedKind, devices, discovery),
        ...(snapshot.plan
          ? [{ type: 'device_selected' as const, payload: { udid: selected.udid } }]
          : []),
        ...planningPatches(snapshot, devices, simulatorAppium),
      ];
    },

    async refreshDevices() {
      const revision = ++deviceSelectionRevision;
      const session = planningSession;
      pendingTargetSwitch = null;
      await refreshUntilTargetSettles();
      if (revision !== deviceSelectionRevision || session !== planningSession) return [];
      const targetKind = targetKindForCurrentPlan();
      const patches: TuiStatePatch[] = [
        {
          type: 'devices_update',
          payload: {
            devices,
            discoveryStatus: discovery.status,
            issues: discovery.issues,
            targetKind,
          },
        },
      ];
      const snapshot = planningSession?.getSnapshot();
      if (snapshot?.plan) patches.push(...planningPatches(snapshot, devices, simulatorAppium));
      return patches;
    },

    modifyPlan(input) {
      if (!planningSession) {
        throw new Error('planning_session_unavailable: submit a test goal first');
      }
      return planningPatches(planningSession.modifyPlan(input), devices, simulatorAppium);
    },

    confirmPlan() {
      if (roundPreparationPending) throw new Error('memory_rounds.review_pending');
      if (!planningSession) {
        throw new Error('planning_session_unavailable: submit a test goal first');
      }
      const snapshot = planningSession.getSnapshot();
      if (!snapshot.plan || planNeedsDeviceSelection(snapshot.plan, devices)) {
        throw new Error(
          'device_selection_required: select one ready execution target before confirming the plan',
        );
      }
      selectConfirmedPlanDevice(snapshot.plan, devices);
      const plan = planningSession.confirmPlan();
      return [
        {
          type: 'plan_update',
          payload: {
            plan,
            confirmed: true,
            connectionSummary:
              plan.device.kind === 'simulator' && simulatorAppium
                ? simulatorConnectionSummary(simulatorAppium)
                : undefined,
          },
        },
        { type: 'mode_change', payload: { mode: 'chat' } },
        {
          type: 'message_add',
          payload: {
            role: 'system',
            text: 'Plan confirmed. Starting execution of the confirmed TestPlan.',
          },
        },
      ];
    },

    executeConfirmedPlan() {
      if (activeTurn) throw new Error('An agent operation is already in progress');
      if (!planningSession?.getConfirmedPlan()) {
        throw new Error('plan_confirmation_required: confirm the displayed TestPlan first');
      }
      latestCommittedRun = null;
      activeTurn = true;
      const queue = new PatchQueue();
      const queueOwner = Symbol('confirmed-plan-execution');
      activeQueue = { owner: queueOwner, queue };
      const controller = new AbortController();
      activeDirectExecutionAbort = controller;
      const callId = `execute-${crypto.randomUUID()}`;
      queue.push({
        type: 'activity_update',
        payload: { id: callId, text: 'Preparing confirmed TestPlan execution…' },
      });

      void (async () => {
        try {
          const result = await toolDispatcher.dispatch(
            { id: callId, name: 'executeTestPlan', arguments: {} },
            controller.signal,
          );
          const committedRun = getLatestCommittedRun();
          queue.push({ type: 'activity_update', payload: { complete: true, id: callId } });
          if (result.status === 'error') {
            const output = result.output as { error?: unknown; code?: unknown } | undefined;
            const retryHint =
              output?.code === 'permission_timeout'
                ? ' To retry, submit /plan <your test goal>, confirm the plan, and answer each permission prompt separately.'
                : String(output?.error ?? '').startsWith('exploration_suggestion_invalid:')
                  ? ' To retry, submit /plan <your test goal> and confirm the new plan. Invalid suggestions were not executed.'
                  : '';
            queue.push({
              type: 'error',
              payload: {
                message: [
                  (committedRun
                    ? `${String(output?.error ?? 'Confirmed TestPlan execution failed')}. Run ${committedRun.runId} was committed with the failure result.`
                    : String(output?.error ?? 'Confirmed TestPlan execution failed')) + retryHint,
                  reportLocationNotice(committedRun),
                ].join('\n'),
                id: callId,
              },
            });
            return;
          }
          const executionOutput =
            typeof result.output === 'object' && result.output !== null
              ? (result.output as Record<string, unknown>)
              : null;
          const deviceResult =
            executionOutput &&
            typeof executionOutput.result === 'object' &&
            executionOutput.result !== null
              ? (executionOutput.result as Record<string, unknown>)
              : null;
          const termination =
            deviceResult &&
            typeof deviceResult.explorationTermination === 'object' &&
            deviceResult.explorationTermination !== null
              ? (deviceResult.explorationTermination as Record<string, unknown>)
              : null;
          const terminationReason = termination?.reason;
          const terminationMessage = termination?.message;
          const assertion =
            deviceResult &&
            typeof deviceResult.assertion === 'object' &&
            deviceResult.assertion !== null
              ? (deviceResult.assertion as Record<string, unknown>)
              : null;
          const assertionStatus =
            committedRun?.runStatus ??
            (typeof assertion?.status === 'string' ? assertion.status : 'inconclusive');
          queue.push({
            type: 'message_add',
            payload: {
              role: 'system',
              ...(!controller.signal.aborted &&
              executionOutput?.status === 'completed' &&
              committedRun?.runStatus
                ? { runStatus: committedRun.runStatus }
                : {}),
              text: [
                (terminationReason === 'no_progress' || terminationReason === 'step_limit') &&
                typeof terminationMessage === 'string'
                  ? terminationMessage +
                    (committedRun
                      ? ` Run ${committedRun.runId} committed with status ${assertionStatus}.`
                      : '')
                  : committedRun
                    ? `Execution completed. Run ${committedRun.runId} committed.`
                    : 'Execution completed.',
                reportLocationNotice(committedRun),
              ].join('\n'),
            },
          });
        } catch (error: unknown) {
          queue.push({
            type: 'error',
            payload: {
              message: `${error instanceof Error ? error.message : String(error)}\n${reportLocationNotice(getLatestCommittedRun())}`,
              id: callId,
            },
          });
        } finally {
          activeTurn = false;
          activeDirectExecutionAbort = null;
          activeExecutionActivityId = null;
          if (activeQueue?.owner === queueOwner) activeQueue = null;
          queue.close();
        }
      })();

      return queue;
    },

    cancelPlan() {
      if (!planningSession) return [];
      planningSession.cancel();
      deviceSelectionRevision += 1;
      pendingTargetSwitch = null;
      selectedDeviceUdid = null;
      return [
        { type: 'plan_update', payload: { plan: null, confirmed: false } },
        { type: 'mode_change', payload: { mode: 'chat' } },
        {
          type: 'message_add',
          payload: {
            role: 'system',
            text: 'Planning cancelled. Use /plan <test goal> to start a new planning cycle.',
          },
        },
      ];
    },

    getConfirmedPlan() {
      return planningSession?.getConfirmedPlan() ?? null;
    },

    async resolvePermission(callId, effect, remember = false) {
      let persisted = false;
      if (effect === 'deny' && remember) {
        const request = pendingPermissions.get(callId);
        if (!request) throw new Error(`Permission request not found: ${callId}`);
        try {
          await persistGlobalDeniedRule({ ...request, effect: 'deny' });
          persisted = true;
        } catch (error: unknown) {
          permissionEngine.resolve(callId, 'deny', false);
          throw error;
        }
      }
      permissionEngine.resolve(callId, effect, persisted);
    },

    cancelPermission(callId, reason = 'user cancelled') {
      permissionEngine.cancel(callId, reason);
    },

    dispose() {
      disposed = true;
      deviceSelectionRevision += 1;
      pendingTargetSwitch = null;
      for (const callId of pendingPermissionIds) {
        permissionEngine.cancel(callId, 'session closed');
      }
      pendingPermissionIds.clear();
      pendingPermissions.clear();
      activeDirectExecutionAbort?.abort('session closed');
      void agentRuntime.abort('session closed');
    },
  };
}

function planningPatches(
  snapshot: ReturnType<PlanningSession['getSnapshot']>,
  devices: readonly DeviceInfo[],
  simulatorAppium?: SimulatorAppiumOptions,
): TuiStatePatch[] {
  const patches: TuiStatePatch[] = [
    { type: 'intent_update', payload: { result: snapshot.intentResult } },
  ];
  if (snapshot.status === 'awaiting_clarification') {
    const clarifications =
      snapshot.intentResult?.status === 'incomplete'
        ? snapshot.intentResult.clarificationsNeeded
        : [];
    for (const clarification of clarifications) {
      patches.push({
        type: 'message_add',
        payload: {
          role: 'system',
          text: clarification.options
            ? `${clarification.question} [${clarification.options.join(' / ')}]`
            : clarification.question,
        },
      });
    }
    return patches;
  }
  if (snapshot.status === 'awaiting_candidate_confirmation') {
    patches.push({
      type: 'candidates_update',
      payload: {
        candidates: snapshot.candidates,
        analysisTier: snapshot.analysis.analysis.analysisTier,
        enabledCapabilities: snapshot.analysis.analysis.enabledCapabilities,
        limitations: snapshot.analysis.analysis.limitations,
      },
    });
    patches.push({ type: 'mode_change', payload: { mode: 'candidate_review' } });
  }
  if (snapshot.status === 'awaiting_execution_route_selection') {
    const candidates =
      snapshot.executionRoute?.status === 'ambiguous' ? snapshot.executionRoute.candidates : [];
    patches.push({ type: 'mode_change', payload: { mode: 'chat' } });
    patches.push({
      type: 'message_add',
      payload: {
        role: 'system',
        text: `Multiple XCUITest execution candidates require selection before plan confirmation:\n${candidates
          .map(
            (candidate) =>
              `- scheme ${candidate.scheme}${candidate.testPlan ? `, test plan ${candidate.testPlan}` : ' (scheme default)'}`,
          )
          .join('\n')}\nReply with: scheme <name> [test plan <name>]`,
      },
    });
  }
  if (snapshot.status === 'execution_route_blocked') {
    const route = snapshot.executionRoute;
    patches.push({ type: 'mode_change', payload: { mode: 'chat' } });
    patches.push({
      type: 'error',
      payload: {
        message:
          route?.status === 'blocked'
            ? `${route.code}: XCUITest candidate resolution is blocked; no DeviceBackend fallback was applied. Correct the scheme/test plan, explicitly reply "use device backend", or cancel the plan.`
            : 'execution_route_blocked',
      },
    });
  }
  if (snapshot.status === 'awaiting_plan_confirmation' && snapshot.plan) {
    if (planNeedsDeviceSelection(snapshot.plan, devices)) {
      patches.push({
        type: 'device_selection_request',
        payload: {
          targetKind: snapshot.plan.device.kind,
          devices,
        },
      });
      patches.push({ type: 'mode_change', payload: { mode: 'device_review' } });
    } else {
      patches.push({
        type: 'plan_update',
        payload: {
          plan: snapshot.plan,
          confirmed: false,
          connectionSummary:
            snapshot.plan.device.kind === 'simulator' && simulatorAppium
              ? simulatorConnectionSummary(simulatorAppium)
              : undefined,
        },
      });
      patches.push({ type: 'mode_change', payload: { mode: 'plan_review' } });
    }
  }
  return patches;
}

function planningSnapshotNeedsUserInput(
  status: ReturnType<PlanningSession['getSnapshot']>['status'],
): boolean {
  return (
    status === 'awaiting_clarification' ||
    status === 'awaiting_candidate_confirmation' ||
    status === 'awaiting_execution_route_selection' ||
    status === 'execution_route_blocked' ||
    status === 'awaiting_plan_confirmation'
  );
}

function deviceUpdatePatch(
  targetKind: TargetKind | null,
  devices: readonly DeviceInfo[],
  discovery: AgentDeviceDiscovery,
): TuiStatePatch {
  return {
    type: 'devices_update',
    payload: {
      devices,
      discoveryStatus: discovery.status,
      issues: discovery.issues,
      targetKind,
    },
  };
}

function planNeedsDeviceSelection(plan: TestPlan, devices: readonly DeviceInfo[]): boolean {
  const selector = plan.device.kind === 'physical' ? plan.device.physical : plan.device.simulator;
  if (selector?.selector === 'by_udid') {
    return !devices.some(
      (device) =>
        device.targetKind === plan.device.kind &&
        device.udid === selector.udid &&
        isDeviceReady(device),
    );
  }
  if (selector?.selector === 'by_name') {
    return !devices.some(
      (device) =>
        device.targetKind === plan.device.kind &&
        device.name === selector.name &&
        isDeviceReady(device),
    );
  }
  return true;
}

function mapEventToPatch(event: AgentEvent): TuiStatePatch | null {
  switch (event.type) {
    case 'assistant.delta':
      return { type: 'message_update', payload: { text: event.delta, id: event.turnId } };
    case 'tool.started':
      return {
        type: 'activity_update',
        payload: {
          text: formatToolActivity(event.name),
          id: event.callId,
        },
      };
    case 'tool.progress':
      return {
        type: 'activity_update',
        payload: { text: event.message, id: event.callId },
      };
    case 'tool.completed':
      return {
        type: 'activity_update',
        payload: { complete: true, id: event.callId },
      };
    case 'tool.failed':
      return { type: 'error', payload: { message: event.error.message, id: event.callId } };
    case 'permission.requested':
      return {
        type: 'permission_request',
        payload: {
          callId: event.callId,
          action: event.action,
          resource: event.resource,
          timeoutMs: event.timeoutMs,
        },
      };
    case 'permission.resolved':
      return {
        type: 'permission_resolved',
        payload: { callId: event.callId, effect: event.effect, reason: event.reason },
      };
    case 'session.error':
      return {
        type: 'error',
        payload: { message: sanitizeProviderErrorMessage(event.error.message) },
      };
    default:
      return null;
  }
}

function formatToolActivity(toolName: string): string {
  const labels: Readonly<Record<string, string>> = {
    analyzeProject: 'Analyzing project…',
    getDeviceInfo: 'Refreshing devices…',
    compileTestPlan: 'Compiling TestPlan…',
    executeTestPlan: 'Executing confirmed TestPlan…',
    generateReport: 'Generating report…',
  };
  return labels[toolName] ?? 'Working…';
}

function summarizeDeviceForModel(device: DeviceInfo) {
  return {
    name: device.name ?? 'Unnamed device',
    targetKind: device.targetKind,
    osVersion: device.osVersion,
    state: device.state,
    availability: isDeviceReady(device) ? ('ready' as const) : ('discovered' as const),
  };
}

/** B29: caps a session transcript to the retention window. */
export function retainSessionTranscript<T>(transcript: readonly T[], maxCount: number): T[] {
  return retainMessages(transcript, maxCount);
}
