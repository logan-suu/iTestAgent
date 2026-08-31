import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type {
  AgentEvent,
  DeviceBackend,
  DeviceDiscoverySnapshot,
  DeviceInfo,
  ToolCall,
  ToolResult,
} from 'itestagent-contracts';
import {
  AiSdkAgentRuntime,
  BackendRegistry,
  BackendSelector,
  PermissionEngine,
  ToolDispatcher,
  createProductionAgentSessionDependencies,
} from 'itestagent-engine';
import type { ProjectAnalysisResult } from 'itestagent-project-analyzer';
import { parse as parseJsonc } from 'jsonc-parser';
import { retainMessages } from './message-retention.js';

interface SessionConfig {
  baseURL?: string;
  model?: string;
}

function loadConfig(): SessionConfig {
  const configPath = resolve(homedir(), '.itestagent', 'config', 'itestagent.jsonc');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const cfg = parseJsonc(raw) as Record<string, unknown>;
    const modelCfg = cfg.model as Record<string, unknown> | undefined;
    return {
      baseURL: (modelCfg?.baseURL as string) ?? 'https://api.deepseek.com/v1',
      model: (modelCfg?.model as string) ?? 'deepseek-chat',
    };
  } catch {
    return {};
  }
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
      'Compile a proposed test plan from confirmed project candidates. This capability may report that its owning task is not wired yet.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  executeTestPlan: {
    description:
      'Execute a user-confirmed test plan on an explicitly selected target. This capability may report that its owning task is not wired yet.',
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

function capabilityNotWired(capability: string, ownerTask: string): never {
  throw new Error(
    `capability_not_wired: ${capability} is owned by task ${ownerTask} and is not available in task 6.2`,
  );
}

export type AgentDeviceDiscovery = DeviceDiscoverySnapshot;

function normalizeDiscovery(value: AgentDeviceDiscovery | DeviceInfo[]): AgentDeviceDiscovery {
  return Array.isArray(value) ? { devices: value, status: 'ok', issues: [] } : value;
}

function isReadyDevice(device: DeviceInfo): boolean {
  return device.targetKind === 'physical' || device.state === 'booted';
}

export interface AgentSessionDependencies {
  loadApiKey?: () => Promise<string | null>;
  createModel?: (config: SessionConfig, apiKey: string) => LanguageModel;
  analyzeWorkspace?: (workspace: string) => Promise<ProjectAnalysisResult>;
  listDevices?: () => Promise<AgentDeviceDiscovery | DeviceInfo[]>;
  createDeviceBackend?: (device: DeviceInfo) => DeviceBackend;
}

export interface TuiAgentSession {
  processMessage(input: string): AsyncIterable<TuiStatePatch>;
  getDevices(): readonly DeviceInfo[];
  resolvePermission(callId: string, effect: 'allow' | 'deny', remember?: boolean): void;
  cancelPermission(callId: string, reason?: string): void;
  dispose(): void;
}

export interface TuiStatePatch {
  type:
    | 'message_add'
    | 'message_update'
    | 'mode_change'
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
  const production = createProductionAgentSessionDependencies();
  const config = loadConfig();
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

  const permissionEngine = new PermissionEngine();
  const pendingPermissionIds = new Set<string>();
  let activeQueue: PatchQueue | null = null;
  let activeTurn = false;
  let discoveryNoticeEmitted = false;

  const toolDispatcher = new ToolDispatcher({
    permissionEngine,
    backendSelector: new BackendSelector(registry),
    targetKind: 'physical',
    customTools: {
      analyzeProject: {
        action: 'analyze_project',
        resource: `workspace:${workspace}`,
        backendName: 'itestagent-project-analyzer',
        execute: () => analyzeWorkspace(workspace),
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
        execute: async () => capabilityNotWired('test-plan compilation', '6.3'),
      },
      executeTestPlan: {
        action: 'execute_test_plan',
        resource: physicalDevice ? `deviceId:${physicalDevice.udid}` : 'device:unselected',
        backendName: 'itestagent-engine',
        execute: async () => capabilityNotWired('test-plan execution', '6.5'),
      },
      generateReport: {
        action: 'generate_report',
        resource: `workspace:${workspace}`,
        backendName: 'itestagent-report',
        execute: async () => capabilityNotWired('report generation', '6.8'),
      },
    },
    onEvent: (event) => {
      if (event.type === 'permission.requested') pendingPermissionIds.add(event.callId);
      if (event.type === 'permission.resolved') pendingPermissionIds.delete(event.callId);
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
    toolExecutor: (call: ToolCall): Promise<ToolResult> => toolDispatcher.dispatch(call),
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
          for await (const event of agentRuntime.streamTurn({
            messages: [{ role: 'user', content: input }],
          })) {
            const patch = mapEventToPatch(event);
            if (patch) queue.push(patch);
          }
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

    resolvePermission(callId, effect, remember = false) {
      permissionEngine.resolve(callId, effect, remember);
    },

    cancelPermission(callId, reason = 'user cancelled') {
      permissionEngine.cancel(callId, reason);
    },

    dispose() {
      for (const callId of pendingPermissionIds) {
        permissionEngine.cancel(callId, 'session closed');
      }
      pendingPermissionIds.clear();
      void agentRuntime.abort('session closed');
    },
  };
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
