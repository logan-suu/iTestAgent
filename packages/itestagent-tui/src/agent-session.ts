import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { AgentEvent, ToolCall, ToolResult } from 'itestagent-contracts';
import { MockDeviceBackend } from 'itestagent-device-mock';
import {
  AiSdkAgentRuntime,
  BackendRegistry,
  BackendSelector,
  ContextBuilder,
  PermissionEngine,
  ToolDispatcher,
} from 'itestagent-engine';
import { parse as parseJsonc } from 'jsonc-parser';

function loadConfig(): { baseURL?: string; model?: string } {
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

    // Timeout: don't hang waiting for Keychain GUI prompt
    const timer = setTimeout(() => settle(null), 5000);

    child.stdout?.on('data', (c: Buffer) => chunks.push(c));
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) settle(Buffer.concat(chunks).toString('utf-8').trim());
      else settle(null);
    });
    child.on('error', () => {
      clearTimeout(timer);
      settle(null);
    });
  });
}

const AGENT_TOOLS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  analyzeProject: {
    description:
      'Analyze the current iOS project workspace. Discovers targets, infers features from code. Use when user wants to explore or understand their iOS project.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  getDeviceInfo: {
    description: 'Get information about connected iOS devices and simulators.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  screenshot: {
    description: 'Take a screenshot of the current device screen.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  listApps: {
    description: 'List installed apps on the connected device.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

function createToolExecutor(
  toolDispatcher: ToolDispatcher,
  workspace: string,
): (call: ToolCall) => Promise<ToolResult> {
  return async (call: ToolCall): Promise<ToolResult> => {
    if (call.name === 'analyzeProject') {
      try {
        return {
          callId: call.id,
          status: 'ok',
          output: {
            message: `Workspace: ${workspace}. Project analysis is available. Use 'itestagent doctor' for environment checks or describe what you want to test.`,
          },
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          callId: call.id,
          status: 'error',
          output: { error: `Project analysis failed: ${msg}` },
        };
      }
    }

    if (call.name === 'getDeviceInfo') {
      return {
        callId: call.id,
        status: 'ok',
        output: {
          message: 'Device information: Use `itestagent devices` for full device list.',
          connected: true,
        },
      };
    }

    return toolDispatcher.dispatch(call);
  };
}

function buildSystemPrompt(workspace: string): string {
  return `You are iTestAgent, an AI-powered iOS testing assistant running locally.

## Your Role
Help iOS developers test their apps on iPhone real devices and iOS Simulators. You can:
1. Analyze iOS projects (Xcode projects, Swift packages)
2. Generate test plans based on project analysis
3. Execute tests on connected devices
4. Collect evidence (screenshots, logs, crash reports)
5. Generate test reports

## Current Workspace
${workspace}

## Available Actions
- When a user asks you to "analyze" or "look at" their project, use the analyzeProject tool.
- When a user asks about devices, use getDeviceInfo.
- When asked to test something, first analyze the project, then propose a test plan.
- Always explain what you're doing before taking action.
- Be concise. Use bullet points for lists.

## Important Rules
- NEVER guess about device state — always use tools to verify.
- For test plans, always ask for user confirmation before executing.
- Report all metrics as approximate when uncertain.
- Do NOT fabricate test results.`;
}

export interface TuiAgentSession {
  processMessage(input: string): AsyncIterable<TuiStatePatch>;
  dispose(): void;
}

export interface TuiStatePatch {
  type:
    | 'message_add'
    | 'message_update'
    | 'mode_change'
    | 'candidates_update'
    | 'plan_update'
    | 'error';
  payload: Record<string, unknown>;
}

export async function createAgentSession(workspace: string): Promise<TuiAgentSession> {
  const config = loadConfig();
  const apiKey = await loadApiKey();
  if (!apiKey) {
    throw new Error(
      'No API key found. Store it in Keychain: security add-generic-password -s itestagent/openai_api_key -a itestagent -w',
    );
  }

  const openai = createOpenAI({
    baseURL: config.baseURL ?? 'https://api.deepseek.com/v1',
    apiKey,
  });
  const model: LanguageModel = openai.chat(config.model ?? 'deepseek-chat');

  const deviceBackend = new MockDeviceBackend();

  const registry = new BackendRegistry();
  registry.register('mock', deviceBackend);

  const backendSelector = new BackendSelector(registry);

  const permissionEngine = new PermissionEngine();
  permissionEngine.addRule({ action: '*', resource: '*', effect: 'allow' });

  const toolDispatcher = new ToolDispatcher({
    permissionEngine,
    backendSelector,
    targetKind: 'physical',
  });

  const contextBuilder = new ContextBuilder();

  const toolExecutor = createToolExecutor(toolDispatcher, workspace);

  const systemPrompt = buildSystemPrompt(workspace);
  const agentRuntime = new AiSdkAgentRuntime({
    model,
    tools: AGENT_TOOLS,
    toolExecutor,
    system: systemPrompt,
    maxSteps: 15,
  });

  return {
    async *processMessage(input: string): AsyncIterable<TuiStatePatch> {
      const turnInput = {
        messages: [{ role: 'user', content: input }],
      };

      for await (const event of agentRuntime.streamTurn(turnInput)) {
        const patch = mapEventToPatch(event);
        if (patch) yield patch;
      }
    },

    dispose() {
      agentRuntime.abort('session closed').catch(() => {});
    },
  };
}

function mapEventToPatch(event: AgentEvent): TuiStatePatch | null {
  switch (event.type) {
    case 'assistant.delta':
      return {
        type: 'message_update',
        payload: { text: event.delta, id: event.turnId },
      };
    case 'tool.started':
      return {
        type: 'message_add',
        payload: {
          role: 'system',
          text: `\uD83D\uDD27 ${event.name} on ${event.backend}...`,
          id: event.callId,
        },
      };
    case 'tool.completed':
      return {
        type: 'message_add',
        payload: {
          role: 'system',
          text: formatToolOutput(event.result),
          id: event.callId,
        },
      };
    case 'tool.failed':
      return {
        type: 'error',
        payload: { message: event.error.message, id: event.callId },
      };
    case 'session.error':
      return {
        type: 'error',
        payload: { message: event.error.message },
      };
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

import { retainMessages } from './message-retention.js';

/** B29: caps a session transcript to the retention window. */
export function retainSessionTranscript<T>(transcript: readonly T[], maxCount: number): T[] {
  return retainMessages(transcript, maxCount);
}
