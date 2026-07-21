import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AgentEvent, AgentTurnInput, ToolCall, ToolResult } from 'itestagent-contracts';
import { AiSdkAgentRuntime } from '../src/ai-sdk-agent-runtime.js';
import type { ToolExecutor } from '../src/ai-sdk-agent-runtime.js';

// ─── Test fixtures ──────────────────────────────────────────

function makeTurnInput(overrides: Partial<AgentTurnInput> = {}): AgentTurnInput {
  return { messages: [{ role: 'user', content: 'Hello' }], ...overrides };
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: 'call_1', name: 'tap', arguments: { x: '0.5', y: '0.5' }, ...overrides };
}

function makeOkResult(callId = 'call_1', output: unknown = { success: true }): ToolResult {
  return { callId, status: 'ok', output };
}

function makeErrorResult(callId = 'call_1', error = 'tool failed'): ToolResult {
  return { callId, status: 'error', output: { error } };
}

type MockPart =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'tool-error'; toolCallId: string; toolName: string; error: unknown }
  | { type: 'error'; error: unknown }
  | { type: 'finish'; finishReason: string };

function mockAiModule(parts: MockPart[]) {
  mock.module('ai', () => ({
    streamText: () => ({
      fullStream: (async function* () {
        for (const part of parts) {
          yield part;
        }
      })(),
    }),
    stepCountIs: () => () => false,
    tool: () => ({}),
  }));
}

describe('AiSdkAgentRuntime', () => {
  let runtime: AiSdkAgentRuntime;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    toolExecutor = mock(async (call: ToolCall) => {
      return makeOkResult(call.id);
    });

    // biome-ignore lint/suspicious/noExplicitAny: test model stub
    const fakeModel = { specificationVersion: 'v4', provider: 'test', modelId: 'test' } as any;

    runtime = new AiSdkAgentRuntime({ model: fakeModel, toolExecutor, maxSteps: 5 });
  });

  afterEach(() => {
    mock.restore();
  });

  // ─── streamTurn: AC1 no tool call → session.idle ─────────

  test('streamTurn yields session.idle when no tool calls', async () => {
    mockAiModule([
      { type: 'text-delta', text: 'Hello from AI' },
      { type: 'finish', finishReason: 'stop' },
    ]);

    const events: AgentEvent[] = [];
    for await (const event of runtime.streamTurn(makeTurnInput())) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('assistant.delta');
    expect(types).toContain('turn.completed');
    expect(types).toContain('session.idle');
  });

  // ─── streamTurn: AC1 tool call → continue ─────────────────

  test('streamTurn yields tool.requested and tool.completed', async () => {
    mockAiModule([
      { type: 'tool-call', toolCallId: 'call_abc', toolName: 'tap', input: { x: '0.5', y: '0.5' } },
      { type: 'tool-result', toolCallId: 'call_abc', toolName: 'tap', output: { success: true } },
      { type: 'text-delta', text: 'Done' },
      { type: 'finish', finishReason: 'stop' },
    ]);

    const events: AgentEvent[] = [];
    for await (const event of runtime.streamTurn(makeTurnInput())) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('tool.requested');
    expect(types).toContain('tool.completed');
    expect(types).toContain('session.idle');
  });

  // ─── streamTurn: tool-error → tool.failed ─────────────────

  test('streamTurn yields tool.failed on tool-error part', async () => {
    mockAiModule([
      {
        type: 'tool-error',
        toolCallId: 'call_err',
        toolName: 'tap',
        error: new Error('tap failed'),
      },
      { type: 'finish', finishReason: 'error' },
    ]);

    const events: AgentEvent[] = [];
    for await (const event of runtime.streamTurn(makeTurnInput())) {
      events.push(event);
    }

    expect(events.map((e) => e.type)).toContain('tool.failed');
  });

  // ─── streamTurn: error part → session.error ───────────────

  test('streamTurn yields session.error on error part', async () => {
    mockAiModule([{ type: 'error', error: new Error('provider crash') }]);

    const events: AgentEvent[] = [];
    for await (const event of runtime.streamTurn(makeTurnInput())) {
      events.push(event);
    }

    expect(events.map((e) => e.type)).toContain('session.error');
  });

  // ─── abort: stops stream → session.aborted ────────────────

  test('abort during active stream with abortSignal-aware mock emits session.aborted', async () => {
    let storedSignal: AbortSignal | undefined;

    mock.module('ai', () => ({
      streamText: (args: unknown) => {
        storedSignal = (args as { abortSignal?: AbortSignal }).abortSignal;
        return {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'before abort' };
            await new Promise((r) => setTimeout(r, 100));
            if (storedSignal?.aborted) {
              throw new Error('aborted');
            }
            yield { type: 'finish', finishReason: 'stop' };
          })(),
        };
      },
      stepCountIs: () => () => false,
      tool: () => ({}),
    }));

    const events: AgentEvent[] = [];
    const streamPromise = (async () => {
      for await (const event of runtime.streamTurn(makeTurnInput())) {
        events.push(event);
      }
    })();

    await new Promise((r) => setTimeout(r, 20));
    await runtime.abort('user cancelled');
    await streamPromise;

    expect(events.map((e) => e.type)).toContain('session.aborted');
  });

  // ─── abort: idempotent ────────────────────────────────────

  test('abort is idempotent', async () => {
    await runtime.abort('first');
    await runtime.abort('second');
    // No throw = idempotent
  });

  // ─── executeToolCall: standalone delegation ───────────────

  test('executeToolCall delegates to toolExecutor', async () => {
    const call = makeToolCall();
    const result = await runtime.executeToolCall(call);
    expect(result.status).toBe('ok');
    expect(toolExecutor).toHaveBeenCalledWith(call);
  });

  // ─── executeToolCall: no executor → error ─────────────────

  test('executeToolCall returns error when no toolExecutor', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test model stub
    const fakeModel = { specificationVersion: 'v4', provider: 'test', modelId: 'test' } as any;
    const rt = new AiSdkAgentRuntime({ model: fakeModel });

    const result = await rt.executeToolCall(makeToolCall());
    expect(result.status).toBe('error');
    const output = result.output as { error: string };
    expect(output.error).toContain('no tool executor');
  });

  // ─── toolExecutor: correct ToolCall received ──────────────

  test('toolExecutor receives ToolCall with name and arguments', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test model stub
    const fakeModel = { specificationVersion: 'v4', provider: 'test', modelId: 'test' } as any;
    const calls: ToolCall[] = [];
    const ex: ToolExecutor = async (call) => {
      calls.push(call);
      return makeOkResult(call.id);
    };
    const rt = new AiSdkAgentRuntime({ model: fakeModel, toolExecutor: ex });

    const call = makeToolCall({ name: 'screenshot', arguments: { quality: 'high' } });
    const result = await rt.executeToolCall(call);
    expect(result.status).toBe('ok');
    expect(calls[0]?.name).toBe('screenshot');
    expect(calls[0]?.arguments).toEqual({ quality: 'high' });
  });

  // ─── toolExecutor: error status propagates ────────────────

  test('toolExecutor error status propagates', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test model stub
    const fakeModel = { specificationVersion: 'v4', provider: 'test', modelId: 'test' } as any;
    const ex: ToolExecutor = async () => makeErrorResult('call_err', 'network timeout');
    const rt = new AiSdkAgentRuntime({ model: fakeModel, toolExecutor: ex });

    const result = await rt.executeToolCall(makeToolCall());
    expect(result.status).toBe('error');
    expect(result.output).toEqual({ error: 'network timeout' });
  });

  // ─── system prompt: constructor → streamText ──────────────

  test('streamTurn passes system from constructor', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test model stub
    const fakeModel = { specificationVersion: 'v4', provider: 'test', modelId: 'test' } as any;
    // biome-ignore lint/suspicious/noExplicitAny: test model stub
    let capturedSystem: any = undefined;

    mock.module('ai', () => ({
      streamText: (args: unknown) => {
        capturedSystem = (args as { system?: string }).system;
        return {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'ok' };
            yield { type: 'finish', finishReason: 'stop' };
          })(),
        };
      },
      stepCountIs: () => () => false,
      tool: () => ({}),
    }));

    const rt = new AiSdkAgentRuntime({
      model: fakeModel,
      toolExecutor,
      system: 'You are a test assistant.',
    });

    const events: AgentEvent[] = [];
    for await (const event of rt.streamTurn(makeTurnInput())) {
      events.push(event);
    }

    expect(capturedSystem).toBe('You are a test assistant.');
    expect(events.some((e) => e.type === 'session.idle')).toBe(true);
  });

  // ─── system prompt: input overrides constructor ────────────

  test('streamTurn system from input overrides constructor', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test model stub
    const fakeModel = { specificationVersion: 'v4', provider: 'test', modelId: 'test' } as any;
    // biome-ignore lint/suspicious/noExplicitAny: test model stub
    let capturedSystem: any = undefined;

    mock.module('ai', () => ({
      streamText: (args: unknown) => {
        capturedSystem = (args as { system?: string }).system;
        return {
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'ok' };
            yield { type: 'finish', finishReason: 'stop' };
          })(),
        };
      },
      stepCountIs: () => () => false,
      tool: () => ({}),
    }));

    const rt = new AiSdkAgentRuntime({
      model: fakeModel,
      toolExecutor,
      system: 'constructor system',
    });

    const events: AgentEvent[] = [];
    for await (const event of rt.streamTurn(makeTurnInput({ system: 'input system' }))) {
      events.push(event);
    }

    expect(capturedSystem).toBe('input system');
    expect(events.some((e) => e.type === 'session.idle')).toBe(true);
  });

  // ─── edge: empty messages ─────────────────────────────────

  test('streamTurn handles empty messages', async () => {
    mockAiModule([
      { type: 'text-delta', text: 'Hi' },
      { type: 'finish', finishReason: 'stop' },
    ]);

    const events: AgentEvent[] = [];
    for await (const event of runtime.streamTurn(makeTurnInput({ messages: [] }))) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'session.idle')).toBe(true);
  });
});

// Helper: create an async generator from parts
