/**
 * Characterization fixtures for the TUI agent session
 * (src/agent-session.ts).
 *
 * agent-session.ts wires a real stack on top of the AI SDK:
 *   Keychain lookup (spawn `/usr/bin/security`) → createOpenAI provider →
 *   MockDeviceBackend + BackendRegistry/Selector → PermissionEngine(allow-all)
 *   → ToolDispatcher(targetKind 'physical') → AiSdkAgentRuntime(maxSteps 15).
 *
 * These fixtures provide deterministic inputs and EXPECTED outputs for that
 * wiring: the exact no-key error, the exact system prompt, the exact tool
 * registry, default provider config, and stream-part scenarios with the
 * patches `processMessage()` must currently emit. They contain expected
 * values only — no behavior is re-implemented here.
 */

import { join } from 'node:path';

import type { TuiStatePatch } from '../../src/agent-session.js';

// ── Deterministic inputs ──────────────────────────────────────────────

export const SAMPLE_WORKSPACE = '/test/workspace';
export const SAMPLE_USER_INPUT = 'analyze my project';

/** Fake Keychain secret returned by the mocked spawn. Not a real key format. */
export const MOCK_API_KEY = 'itestagent-char-key-0123456789';

// ── Config defaults locked by loadConfig()'s catch path ───────────────

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_MODEL_ID = 'deepseek-chat';

/**
 * Path suffix of the config file loadConfig() reads
 * (`~/.itestagent/config/itestagent.jsonc`). The characterization suite
 * treats ONLY paths matching this suffix as absent; every other path falls
 * through to the real fs, because Bun module mocks persist across test files
 * in the same process and a blanket throwing mock would pollute suites that
 * are loaded later and legitimately read fixtures via readFileSync.
 */
export const CONFIG_PATH_SUFFIX = join('.itestagent', 'config', 'itestagent.jsonc');

// ── API-key gate ──────────────────────────────────────────────────────

/** Exact rejection message when loadApiKey() resolves null. */
export const NO_API_KEY_ERROR =
  'No API key found. Store it in Keychain: security add-generic-password -s itestagent/openai_api_key -a itestagent -w';

/**
 * Scripted outcomes for the mocked `/usr/bin/security` child process.
 * exitCode 44 is what security(1) actually returns for "item not found";
 * any non-zero code takes the same null path.
 */
export const KEYCHAIN_MISS = { exitCode: 44, password: null } as const;
export const KEYCHAIN_HIT = { exitCode: 0, password: MOCK_API_KEY } as const;

// ── Runtime configuration locks ───────────────────────────────────────

export const MAX_STEPS = 15;

/** Exact system prompt built by buildSystemPrompt(workspace). */
export function expectedSystemPrompt(workspace: string): string {
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

// ── Tool registry locks (AGENT_TOOLS) ────────────────────────────────

export interface CharacterizedToolDef {
  readonly description: string;
  readonly parameters: { type: 'object'; properties: Record<string, never>; required: [] };
}

/** Exact AGENT_TOOLS entries in declaration order. */
export const AGENT_TOOLS_FIXTURE: Readonly<Record<string, CharacterizedToolDef>> = {
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

export const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOLS_FIXTURE);

// ── Built-in executor branches (createToolExecutor) ───────────────────

/** Exact ok-output for the analyzeProject short-circuit branch. */
export function expectedAnalyzeProjectOutput(workspace: string): { message: string } {
  return {
    message: `Workspace: ${workspace}. Project analysis is available. Use 'itestagent doctor' for environment checks or describe what you want to test.`,
  };
}

/** Exact ok-output for the getDeviceInfo short-circuit branch. */
export const EXPECTED_GET_DEVICE_INFO_OUTPUT = {
  message: 'Device information: Use `itestagent devices` for full device list.',
  connected: true,
} as const;

/**
 * A tool name that is registered in AGENT_TOOLS but absent from the engine's
 * TOOL_REGISTRY — exercises the fall-through `toolDispatcher.dispatch(call)`
 * branch, which rejects unknown tools deterministically.
 */
export const UNKNOWN_DISPATCH_TOOL_NAME = 'listApps';
export const UNKNOWN_DISPATCH_ERROR_PREFIX = 'Unknown tool: "listApps". Available tools: ';

// ── Stream scenarios: parts in → patches out ─────────────────────────

export type MockStreamPart = Record<string, unknown>;

/** Two text deltas; both must map to message_update patches sharing one turn id. */
export const TEXT_DELTA_PARTS: readonly MockStreamPart[] = [
  { type: 'text-delta', text: 'Hello' },
  { type: 'text-delta', text: ' from iTestAgent' },
  { type: 'finish', finishReason: 'stop' },
];
export const TEXT_DELTA_EXPECTED_TEXTS = ['Hello', ' from iTestAgent'] as const;

/**
 * tool-call part maps to AgentEvent 'tool.requested', which mapEventToPatch
 * does NOT handle — it must produce NO patch (current quirk under lock).
 * The following tool-result part becomes one system message_add whose text
 * is formatToolOutput(): JSON.stringify(output, null, 2) for objects.
 */
export const TOOL_RESULT_PARTS: readonly MockStreamPart[] = [
  {
    type: 'tool-call',
    toolCallId: 'call_char_1',
    toolName: 'getDeviceInfo',
    input: {},
  },
  {
    type: 'tool-result',
    toolCallId: 'call_char_1',
    toolName: 'getDeviceInfo',
    output: { ok: true, count: 2 },
  },
  { type: 'finish', finishReason: 'stop' },
];
export const TOOL_RESULT_CALL_ID = 'call_char_1';
export const TOOL_RESULT_OUTPUT = { ok: true, count: 2 };
export const TOOL_RESULT_EXPECTED_TEXT = JSON.stringify(TOOL_RESULT_OUTPUT, null, 2);

/** tool-error part → error patch carrying the redacted message + call id. */
export const TOOL_ERROR_PARTS: readonly MockStreamPart[] = [
  {
    type: 'tool-error',
    toolCallId: 'call_char_err',
    toolName: 'screenshot',
    error: new Error('device disconnected during capture'),
  },
  { type: 'finish', finishReason: 'error' },
];
export const TOOL_ERROR_CALL_ID = 'call_char_err';
export const TOOL_ERROR_EXPECTED_MESSAGE = 'device disconnected during capture';

/** error part → session.error → error patch carrying the message WITHOUT an id. */
export const SESSION_ERROR_PARTS: readonly MockStreamPart[] = [
  { type: 'error', error: new Error('provider socket exploded') },
];
export const SESSION_ERROR_EXPECTED_MESSAGE = 'provider socket exploded';

// ── Patch assertion helpers ───────────────────────────────────────────

export function patchTypes(patches: readonly TuiStatePatch[]): string[] {
  return patches.map((p) => p.type);
}
