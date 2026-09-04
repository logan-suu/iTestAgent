import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { type LanguageModel, generateText } from 'ai';
import type {
  AgentEvent,
  DeviceBackend,
  DeviceDiscoverySnapshot,
  DeviceInfo,
  TestPlan,
  ToolCall,
  ToolResult,
} from 'itestagent-contracts';
import {
  AiSdkAgentRuntime,
  BackendRegistry,
  BackendSelector,
  PermissionEngine,
  PlanningSession,
  type ProductionActionSuggestion,
  type ProductionAgentSessionDependencies,
  type ProductionExecutionTransports,
  ToolDispatcher,
  assertProviderUrl,
  createProductionAgentSessionDependencies,
  executeProductionTestPlanToDefaultStore,
  productionPermissionActions,
  suggestExplorationAction,
} from 'itestagent-engine';
import type { CandidateLink, ProjectAnalysisResult } from 'itestagent-project-analyzer';
import { persistGlobalDeniedRule } from './global-deny-store.js';
import { retainMessages } from './message-retention.js';
import { loadTuiRuntimeConfig } from './runtime-config.js';

interface SessionConfig {
  baseURL?: string;
  model?: string;
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

function isReadyDevice(device: DeviceInfo): boolean {
  return device.targetKind === 'physical' || device.state === 'booted';
}

export function selectConfirmedPlanDevice(
  plan: TestPlan,
  devices: readonly DeviceInfo[],
): DeviceInfo {
  let candidates = devices.filter(
    (device) => device.targetKind === plan.device.kind && isReadyDevice(device),
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
  loadApiKey?: () => Promise<string | null>;
  createModel?: (config: SessionConfig, apiKey: string) => LanguageModel;
  analyzeWorkspace?: (workspace: string) => Promise<ProjectAnalysisResult>;
  listDevices?: () => Promise<AgentDeviceDiscovery | DeviceInfo[]>;
  createDeviceBackend?: (device: DeviceInfo) => DeviceBackend;
  closeDeviceBackend?: ProductionAgentSessionDependencies['closeDeviceBackend'];
  /** Full production composition; tests should replace only its external transport boundaries. */
  production?: ProductionAgentSessionDependencies;
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
  }) => Promise<unknown>;
}

export interface TuiAgentSession {
  processMessage(input: string): AsyncIterable<TuiStatePatch>;
  getDevices(): readonly DeviceInfo[];
  confirmCandidates(candidates: readonly CandidateLink[]): readonly TuiStatePatch[];
  modifyPlan(input: string): readonly TuiStatePatch[];
  confirmPlan(): readonly TuiStatePatch[];
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
    | 'plan_update'
    | 'permission_request'
    | 'permission_resolved'
    | 'devices_update'
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

export async function createAgentSession(
  workspace: string,
  dependencies: AgentSessionDependencies = {},
): Promise<TuiAgentSession> {
  const production = dependencies.production ?? createProductionAgentSessionDependencies();
  const runtimeConfig = loadTuiRuntimeConfig({ workspace });
  const config: SessionConfig = {
    baseURL: runtimeConfig.model.baseURL ?? 'https://api.deepseek.com/v1',
    model: runtimeConfig.model.model ?? 'deepseek-chat',
  };
  assertProviderUrl(config.baseURL ?? 'https://api.deepseek.com/v1');
  const apiKey = await (dependencies.loadApiKey ?? loadApiKey)();
  if (!apiKey) {
    throw new Error(
      'No API key found. Store it in Keychain: security add-generic-password -s itestagent/openai_api_key -a itestagent -w',
    );
  }

  const model = dependencies.createModel
    ? dependencies.createModel(config, apiKey)
    : createOpenAI({
        baseURL: config.baseURL ?? 'https://api.deepseek.com/v1',
        apiKey,
      }).chat(config.model ?? 'deepseek-chat');

  const analyzeWorkspace = dependencies.analyzeWorkspace ?? production.analyzeWorkspace;
  const listDevices = dependencies.listDevices ?? (() => production.deviceDiscovery.discover());
  const preparesWda =
    dependencies.preparesWda ??
    (dependencies.createDeviceBackend ? () => false : (production.preparesWda ?? (() => false)));
  let discovery = normalizeDiscovery(await listDevices());
  let devices = discovery.devices;
  const physicalDevice = devices.find((device) => device.targetKind === 'physical');

  const registry = new BackendRegistry();
  if (physicalDevice) {
    registry.register(
      'appium',
      (dependencies.createDeviceBackend ?? production.createDeviceBackend)(physicalDevice),
    );
  }

  const permissionEngine = new PermissionEngine({
    preloadedRules: runtimeConfig.permissions.deniedRules,
  });
  const pendingPermissionIds = new Set<string>();
  const pendingPermissions = new Map<string, { action: string; resource: string }>();
  let activeQueue: PatchQueue | null = null;
  let activeTurn = false;
  let discoveryNoticeEmitted = false;
  let planningSession: PlanningSession | null = null;
  let cachedAnalysis: ProjectAnalysisResult | null = null;
  const transcript: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const analyzeOnce = async (): Promise<ProjectAnalysisResult> => {
    if (!cachedAnalysis) cachedAnalysis = await analyzeWorkspace(workspace);
    return cachedAnalysis;
  };
  let latestCommittedRun: { runId: string; runDir: string } | null = null;

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
    const actions =
      plan.execution.resolvedPath === 'xcuitest'
        ? [...productionPermissionActions(plan)]
        : ['replace_device_app', ...productionPermissionActions(plan, preparesWda(device))];
    return { plan, device, bundleId, resource, actions };
  };

  const executeConfirmedPlan =
    dependencies.executeConfirmedPlan ??
    (async ({ plan, workspace: executionWorkspace, device, signal }) => {
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
        preparesWda: preparesWda(device),
        suggest:
          dependencies.suggestExplorationAction ??
          (({ caseId, uiTree, history, signal: suggestionSignal }) =>
            suggestExplorationAction({
              generate: async (prompt, runSignal) =>
                (await generateText({ model, prompt, abortSignal: runSignal })).text,
              caseId,
              uiTree,
              history,
              signal: suggestionSignal,
            })),
        authorize: (action, resource) =>
          authorizedByExecutionTool.has(`${action}\u0000${resource}`)
            ? Promise.resolve(true)
            : toolDispatcher.authorize(
                `execution-${crypto.randomUUID()}`,
                action,
                resource,
                signal,
              ),
        production: {
          analyzeWorkspace,
          deviceDiscovery: production.deviceDiscovery,
          createDeviceBackend: dependencies.createDeviceBackend ?? production.createDeviceBackend,
          closeDeviceBackend: dependencies.closeDeviceBackend ?? production.closeDeviceBackend,
        },
        transports: dependencies.transports,
        signal,
      });
      latestCommittedRun = { runId: plan.runId, runDir: executed.runDir };
      return executed;
    });

  const toolDispatcher = new ToolDispatcher({
    permissionEngine,
    backendSelector: new BackendSelector(registry),
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
          discovery = normalizeDiscovery(await listDevices());
          devices = discovery.devices;
          activeQueue?.push({
            type: 'devices_update',
            payload: {
              devices,
              discoveryStatus: discovery.status,
              issues: discovery.issues,
            },
          });
          if (discovery.issues.length > 0) {
            activeQueue?.push({
              type: 'message_add',
              payload: {
                role: 'system',
                text: `Device discovery ${discovery.status}: ${discovery.issues.map((issue) => `${issue.lane}: ${issue.message}`).join('; ')}`,
              },
            });
          }
          return {
            connected: devices.some(isReadyDevice),
            selectedDevice: devices.find((device) => device.targetKind === 'physical') ?? null,
            devices,
            discoveryStatus: discovery.status,
            limitations: discovery.issues,
          };
        },
      },
      compileTestPlan: {
        action: 'generate_draft_test',
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
        action: () => confirmedExecutionContext().actions[0] ?? 'replace_device_app',
        additionalActions: () => confirmedExecutionContext().actions.slice(1),
        resource: () => confirmedExecutionContext().resource,
        backendName: 'itestagent-engine',
        execute: async (_args, signal) => {
          const { plan, device } = confirmedExecutionContext();
          return executeConfirmedPlan({ plan, workspace, device, signal });
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
        if (patch) activeQueue?.push(patch);
      }
    },
  });

  const agentRuntime = new AiSdkAgentRuntime({
    model,
    tools: AGENT_TOOLS,
    toolExecutor: (call: ToolCall, signal?: AbortSignal): Promise<ToolResult> =>
      toolDispatcher.dispatch(call, signal),
    system: buildSystemPrompt(workspace),
    maxSteps: 15,
  });

  return {
    processMessage(input: string): AsyncIterable<TuiStatePatch> {
      if (activeTurn) throw new Error('An agent turn is already in progress');
      activeTurn = true;
      const queue = new PatchQueue();
      activeQueue = queue;
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
              queue.push({ type: 'planning_reset', payload: {} });
            }
            for (const patch of planningPatches(planningSnapshot)) queue.push(patch);
          }

          transcript.push({ role: 'user', content: input });
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
          activeQueue = null;
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
      return planningPatches(planningSession.confirmCandidates(candidates));
    },

    modifyPlan(input) {
      if (!planningSession) {
        throw new Error('planning_session_unavailable: submit a test goal first');
      }
      return planningPatches(planningSession.modifyPlan(input));
    },

    confirmPlan() {
      if (!planningSession) {
        throw new Error('planning_session_unavailable: submit a test goal first');
      }
      const plan = planningSession.confirmPlan();
      return [
        { type: 'plan_update', payload: { plan, confirmed: true } },
        { type: 'mode_change', payload: { mode: 'chat' } },
        {
          type: 'message_add',
          payload: {
            role: 'system',
            text: 'Plan confirmed. Use /plan <test goal> to start a new planning cycle.',
          },
        },
      ];
    },

    cancelPlan() {
      if (!planningSession) return [];
      planningSession.cancel();
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
      for (const callId of pendingPermissionIds) {
        permissionEngine.cancel(callId, 'session closed');
      }
      pendingPermissionIds.clear();
      pendingPermissions.clear();
      void agentRuntime.abort('session closed');
    },
  };
}

function planningPatches(snapshot: ReturnType<PlanningSession['getSnapshot']>): TuiStatePatch[] {
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
    patches.push({ type: 'plan_update', payload: { plan: snapshot.plan, confirmed: false } });
    patches.push({ type: 'mode_change', payload: { mode: 'plan_review' } });
  }
  return patches;
}

function mapEventToPatch(event: AgentEvent): TuiStatePatch | null {
  switch (event.type) {
    case 'assistant.delta':
      return { type: 'message_update', payload: { text: event.delta, id: event.turnId } };
    case 'tool.started':
      return {
        type: 'message_add',
        payload: {
          role: 'system',
          text: `Tool ${event.name} on ${event.backend}...`,
          id: event.callId,
        },
      };
    case 'tool.progress':
      return {
        type: 'message_add',
        payload: {
          role: 'system',
          text:
            event.percent === undefined ? event.message : `${event.message} (${event.percent}%)`,
          id: event.callId,
        },
      };
    case 'tool.completed':
      return {
        type: 'message_add',
        payload: { role: 'system', text: formatToolOutput(event.result), id: event.callId },
      };
    case 'tool.failed':
      return { type: 'error', payload: { message: event.error.message, id: event.callId } };
    case 'permission.requested':
      return {
        type: 'permission_request',
        payload: { callId: event.callId, action: event.action, resource: event.resource },
      };
    case 'permission.resolved':
      return {
        type: 'permission_resolved',
        payload: { callId: event.callId, effect: event.effect },
      };
    case 'session.error':
      return { type: 'error', payload: { message: event.error.message } };
    default:
      return null;
  }
}

function formatToolOutput(result: ToolResult): string {
  if (typeof result.output === 'string') return result.output;
  try {
    return JSON.stringify(result.output, null, 2);
  } catch {
    return String(result.output);
  }
}

/** B29: caps a session transcript to the retention window. */
export function retainSessionTranscript<T>(transcript: readonly T[], maxCount: number): T[] {
  return retainMessages(transcript, maxCount);
}
