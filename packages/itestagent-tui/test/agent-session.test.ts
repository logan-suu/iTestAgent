/**
 * Characterization tests for the TUI agent session (src/agent-session.ts).
 *
 * agent-session.ts is the TUI's wiring root: it loads config from
 * `~/.itestagent/config/itestagent.jsonc`, reads the API key from the macOS
 * Keychain (`/usr/bin/security find-generic-password …`), builds an
 * OpenAI-compatible provider, and assembles the engine stack
 * (MockDeviceBackend → BackendRegistry/Selector → PermissionEngine allow-all →
 * ToolDispatcher(targetKind 'physical') → AiSdkAgentRuntime(maxSteps 15)).
 *
 * This suite locks the CURRENT behavior of that wiring against the old
 * source, without a live LLM and without touching the real Keychain:
 *   - `node:child_process.spawn` is selectively replaced so the Keychain
 *     lookup is deterministic (miss / hit / spawn-error paths) while every
 *     other spawn delegates to the real implementation;
 *   - `node:fs.readFileSync` is selectively replaced so loadConfig() takes
 *     its catch path for the config file and the documented defaults apply,
 *     while every other path uses the real fs;
 *   - `@ai-sdk/openai` and `ai` are replaced so the provider/model handoff
 *     and the stream-part → TuiStatePatch mapping can be observed exactly.
 *
 * Selectivity matters because Bun module mocks persist across test files in
 * the same process: a blanket throwing/overriding mock would leak into
 * later-loaded suites.
 *
 * Everything asserted here is real current behavior of agent-session.ts,
 * including quirks (e.g. `tool.requested` events produce no patch because
 * mapEventToPatch only handles `tool.started`).
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SpawnOptions } from 'node:child_process';
import * as childProcessReal from 'node:child_process';
import * as fsReal from 'node:fs';
import type { TuiAgentSession, TuiStatePatch } from '../src/agent-session.js';
import {
  AGENT_TOOLS_FIXTURE,
  AGENT_TOOL_NAMES,
  CONFIG_PATH_SUFFIX,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_ID,
  KEYCHAIN_HIT,
  KEYCHAIN_MISS,
  MAX_STEPS,
  MOCK_API_KEY,
  type MockStreamPart,
  NO_API_KEY_ERROR,
  SAMPLE_USER_INPUT,
  SAMPLE_WORKSPACE,
  SESSION_ERROR_EXPECTED_MESSAGE,
  SESSION_ERROR_PARTS,
  TEXT_DELTA_EXPECTED_TEXTS,
  TEXT_DELTA_PARTS,
  TOOL_ERROR_CALL_ID,
  TOOL_ERROR_EXPECTED_MESSAGE,
  TOOL_ERROR_PARTS,
  TOOL_RESULT_CALL_ID,
  TOOL_RESULT_EXPECTED_TEXT,
  TOOL_RESULT_OUTPUT,
  TOOL_RESULT_PARTS,
  UNKNOWN_DISPATCH_ERROR_PREFIX,
  UNKNOWN_DISPATCH_TOOL_NAME,
  expectedAnalyzeProjectOutput,
  expectedSystemPrompt,
  patchTypes,
} from './fixtures/agent-session-characterization.js';

// Capture REAL implementations before mock.module() below. Bun patches the
// module namespace in place, so property access through `fsReal` /
// `childProcessReal` after registration would resolve to the mocks
// themselves and make any fall-through recurse infinitely.
const realReadFileSync = fsReal.readFileSync;
const realSpawn = childProcessReal.spawn;

// ── Module mocks (registered before the dynamic import below) ─────────

/** Scripted outcome for the mocked `/usr/bin/security` child process. */
interface KeychainScript {
  exitCode: number;
  password: string | null;
  /** Emit an 'error' event instead of a normal close. */
  emitError?: boolean;
}

type SpawnFn = typeof childProcessReal.spawn;

type ScriptedSpawnFn = (command: string, args: readonly string[], options: unknown) => unknown;

function scriptedSpawn(script: KeychainScript): ScriptedSpawnFn {
  return (command, args, options) => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const child = {
      stdout: {
        on: (_event: 'data', callback: (chunk: Buffer) => void) => {
          queueMicrotask(() => {
            if (script.password !== null) callback(Buffer.from(script.password, 'utf-8'));
            queueMicrotask(() => {
              if (script.emitError) {
                listeners.get('error')?.(new Error('security spawn failed'));
              } else {
                listeners.get('close')?.(script.exitCode);
              }
            });
          });
        },
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        listeners.set(event, callback);
      },
      kill: () => {},
    };
    void command;
    void args;
    void options;
    return child;
  };
}

// Mutable delegates configured per test.
let spawnScript: KeychainScript = KEYCHAIN_HIT;
let fullStreamParts: readonly MockStreamPart[] = [];

// Captured wiring values.
let capturedOpenAiConfig: Record<string, unknown> | undefined;
let capturedModelId: string | undefined;
let capturedModelInstance: Record<string, unknown> | undefined;
let capturedStreamTextArgs: Record<string, unknown> | undefined;
let capturedStepCount: number | undefined;

const FAKE_MODEL_INSTANCE = {
  specificationVersion: 'v2',
  provider: 'itestagent-characterization',
  modelId: 'characterization-model',
};

const spawnOverride: SpawnFn = ((command: string, args: readonly string[], options: unknown) => {
  // Selective interception: only the Keychain lookup goes through the
  // scripted fake. Bun module mocks persist across test files in the same
  // process, so every other spawn must delegate to the real child_process.
  if (command !== '/usr/bin/security') {
    return realSpawn(command, args, options as SpawnOptions);
  }
  return scriptedSpawn(spawnScript)(command, args, options);
}) as unknown as SpawnFn;

mock.module('node:child_process', () => ({
  ...childProcessReal,
  spawn: spawnOverride,
  default: { ...childProcessReal, spawn: spawnOverride },
}));

// Force loadConfig()'s catch path regardless of machine state: the config
// file is treated as absent, so the documented defaults must apply. The mock
// is selective — only the config path throws; all other paths fall through to
// the real fs, because Bun module mocks persist across test files in the same
// process and a blanket throwing readFileSync would break later-loaded suites
// that legitimately read fixtures with the real implementation.
function selectiveReadFileSync(
  filePath: Parameters<typeof fsReal.readFileSync>[0],
  options?: Parameters<typeof fsReal.readFileSync>[1],
): string | Buffer {
  const key = typeof filePath === 'string' ? filePath : filePath.toString();
  if (key.includes(CONFIG_PATH_SUFFIX)) {
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${key}'`), {
      code: 'ENOENT',
    });
  }
  // Pass through the REAL return type untouched: later-loaded suites in the
  // same process (Bun module mocks persist across files) rely on readFileSync
  // returning a Buffer when no encoding is given (e.g. artifact byte
  // comparisons via Buffer#equals).
  return realReadFileSync(filePath, options as never);
}

mock.module('node:fs', () => ({
  ...fsReal,
  readFileSync: selectiveReadFileSync,
  default: { ...fsReal, readFileSync: selectiveReadFileSync },
}));

mock.module('@ai-sdk/openai', () => ({
  createOpenAI: (config: Record<string, unknown>) => {
    capturedOpenAiConfig = config;
    return {
      chat: (modelId: string) => {
        capturedModelId = modelId;
        capturedModelInstance = FAKE_MODEL_INSTANCE;
        return FAKE_MODEL_INSTANCE;
      },
    };
  },
}));

mock.module('ai', () => ({
  streamText: (args: Record<string, unknown>) => {
    capturedStreamTextArgs = args;
    return {
      fullStream: (async function* () {
        for (const part of fullStreamParts) {
          yield part;
        }
      })(),
    };
  },
  stepCountIs: (count: number) => {
    capturedStepCount = count;
    return (): boolean => false;
  },
  tool: (options: Record<string, unknown>) => options,
}));

// ── Harness ───────────────────────────────────────────────────────────

let createAgentSession: typeof import('../src/agent-session.js').createAgentSession;

interface SdkTool {
  description: string;
  parameters: unknown;
  execute: (args: unknown, options: { toolCallId: string }) => Promise<unknown>;
}

function capturedSdkTools(): Record<string, SdkTool> {
  const tools = capturedStreamTextArgs?.tools as Record<string, SdkTool> | undefined;
  if (!tools) throw new Error('streamText was not invoked — run processMessage() first');
  return tools;
}

async function collectPatches(
  session: TuiAgentSession,
  input: string = SAMPLE_USER_INPUT,
): Promise<TuiStatePatch[]> {
  const patches: TuiStatePatch[] = [];
  for await (const patch of session.processMessage(input)) {
    patches.push(patch);
  }
  return patches;
}

function sdkTool(name: string): SdkTool {
  const tool = capturedSdkTools()[name];
  if (!tool) throw new Error(`tool ${name} was not registered in the SDK tool set`);
  return tool;
}

beforeEach(async () => {
  spawnScript = KEYCHAIN_HIT;
  fullStreamParts = [];
  capturedOpenAiConfig = undefined;
  capturedModelId = undefined;
  capturedModelInstance = undefined;
  capturedStreamTextArgs = undefined;
  capturedStepCount = undefined;

  const mod = await import('../src/agent-session.js');
  createAgentSession = mod.createAgentSession;
});

// ── API-key gate ──────────────────────────────────────────────────────

describe('createAgentSession — API key gate', () => {
  it('rejects with the exact Keychain hint when the keychain item is missing', async () => {
    spawnScript = KEYCHAIN_MISS;
    const error = await createAgentSession(SAMPLE_WORKSPACE).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(NO_API_KEY_ERROR);
  });

  it('treats a security(1) spawn error the same as a missing key', async () => {
    spawnScript = { ...KEYCHAIN_MISS, emitError: true };
    const error = await createAgentSession(SAMPLE_WORKSPACE).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(NO_API_KEY_ERROR);
  });
});

// ── Provider wiring ───────────────────────────────────────────────────

describe('createAgentSession — provider wiring', () => {
  it('resolves with the TuiAgentSession surface when a key is present', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    expect(typeof session.processMessage).toBe('function');
    expect(typeof session.dispose).toBe('function');
  });

  it('creates the OpenAI-compatible provider with the keychain key and config defaults', async () => {
    await createAgentSession(SAMPLE_WORKSPACE);
    // loadConfig() catch path (readFileSync mocked absent) → documented defaults.
    expect(capturedOpenAiConfig).toEqual({ baseURL: DEFAULT_BASE_URL, apiKey: MOCK_API_KEY });
    expect(capturedModelId).toBe(DEFAULT_MODEL_ID);
  });

  it('passes the provider model straight into streamText', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = [{ type: 'finish', finishReason: 'stop' }];
    await collectPatches(session);
    expect(capturedModelInstance).toBeDefined();
    expect(capturedStreamTextArgs?.model).toBe(capturedModelInstance);
  });
});

// ── Runtime configuration locks ───────────────────────────────────────

describe('processMessage — runtime configuration', () => {
  it('sends the exact system prompt, user turn mapping, and maxSteps budget', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = [{ type: 'finish', finishReason: 'stop' }];
    await collectPatches(session);

    expect(capturedStreamTextArgs?.system).toBe(expectedSystemPrompt(SAMPLE_WORKSPACE));
    expect(capturedStreamTextArgs?.messages).toEqual([
      { role: 'user', content: SAMPLE_USER_INPUT },
    ]);
    expect(capturedStepCount).toBe(MAX_STEPS);
  });

  it('registers exactly the four AGENT_TOOLS in declaration order with fixed metadata', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = [{ type: 'finish', finishReason: 'stop' }];
    await collectPatches(session);

    const tools = capturedSdkTools();
    expect(Object.keys(tools)).toEqual(AGENT_TOOL_NAMES);
    for (const name of AGENT_TOOL_NAMES) {
      const fixture = AGENT_TOOLS_FIXTURE[name];
      const registered = tools[name];
      if (!fixture || !registered) {
        throw new Error(`missing characterization fixture or registration for ${name}`);
      }
      expect(registered.description).toBe(fixture.description);
      expect(registered.parameters).toEqual(fixture.parameters);
    }
  });
});

// ── Event → patch mapping ─────────────────────────────────────────────

describe('processMessage — event to patch mapping', () => {
  it('maps text deltas to message_update patches sharing one turn id', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = TEXT_DELTA_PARTS;

    const patches = await collectPatches(session);

    expect(patchTypes(patches)).toEqual(['message_update', 'message_update']);
    expect(patches[0]?.payload.text).toBe(TEXT_DELTA_EXPECTED_TEXTS[0]);
    expect(patches[1]?.payload.text).toBe(TEXT_DELTA_EXPECTED_TEXTS[1]);
    const firstId = patches[0]?.payload.id;
    expect(firstId).toMatch(/^turn_\d+$/);
    expect(patches[1]?.payload.id).toBe(firstId);
    // finish / turn.completed / session.idle events produce NO patches.
    expect(patches).toHaveLength(TEXT_DELTA_EXPECTED_TEXTS.length);
  });

  it('emits no patch for tool-call parts but formats tool results as pretty JSON system messages', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = TOOL_RESULT_PARTS;

    const patches = await collectPatches(session);

    // Quirk under lock: 'tool.requested' (from tool-call parts) is unmapped.
    expect(patchTypes(patches)).toEqual(['message_add']);
    expect(patches[0]?.payload.role).toBe('system');
    expect(patches[0]?.payload.text).toBe(TOOL_RESULT_EXPECTED_TEXT);
    expect(patches[0]?.payload.id).toBe(TOOL_RESULT_CALL_ID);
    expect(TOOL_RESULT_EXPECTED_TEXT).toBe(JSON.stringify(TOOL_RESULT_OUTPUT, null, 2));
  });

  it('maps tool-error parts to an error patch carrying message and call id', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = TOOL_ERROR_PARTS;

    const patches = await collectPatches(session);

    expect(patchTypes(patches)).toEqual(['error']);
    expect(patches[0]?.payload.message).toBe(TOOL_ERROR_EXPECTED_MESSAGE);
    expect(patches[0]?.payload.id).toBe(TOOL_ERROR_CALL_ID);
  });

  it('maps session errors to an error patch carrying the message WITHOUT an id', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = SESSION_ERROR_PARTS;

    const patches = await collectPatches(session);

    expect(patchTypes(patches)).toEqual(['error']);
    expect(patches[0]?.payload.message).toBe(SESSION_ERROR_EXPECTED_MESSAGE);
    expect('id' in (patches[0]?.payload ?? {})).toBe(false);
  });
});

// ── Built-in tool executor branches ───────────────────────────────────

describe('tool executor branches', () => {
  it('short-circuits analyzeProject with the workspace-aware canned output', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = [{ type: 'finish', finishReason: 'stop' }];
    await collectPatches(session);

    const output = await sdkTool('analyzeProject').execute({}, { toolCallId: 'call_x1' });
    expect(output).toEqual(expectedAnalyzeProjectOutput(SAMPLE_WORKSPACE));
  });

  it('short-circuits getDeviceInfo with the canned connected response', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = [{ type: 'finish', finishReason: 'stop' }];
    await collectPatches(session);

    const output = await sdkTool('getDeviceInfo').execute({}, { toolCallId: 'call_x2' });
    expect(output).toEqual({
      message: 'Device information: Use `itestagent devices` for full device list.',
      connected: true,
    });
  });

  it('falls through to the dispatcher for non-builtin tools, which rejects unknown names', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    fullStreamParts = [{ type: 'finish', finishReason: 'stop' }];
    await collectPatches(session);

    const error = await sdkTool(UNKNOWN_DISPATCH_TOOL_NAME)
      .execute({}, { toolCallId: 'call_x3' })
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message.startsWith(UNKNOWN_DISPATCH_ERROR_PREFIX)).toBe(true);
  });
});

// ── dispose ───────────────────────────────────────────────────────────

describe('dispose', () => {
  it('is safe to call before any turn and returns nothing', async () => {
    const session = await createAgentSession(SAMPLE_WORKSPACE);
    expect(session.dispose()).toBeUndefined();
  });
});
