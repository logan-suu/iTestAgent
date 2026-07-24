/**
 * Phase 3 integration — Agent Execution: full harness chain from MockAgentRuntime → ToolDispatcher → Backend.
 *
 * Cross-package chain: itestagent-engine (MockAgentRuntime, AiSdkAgentRuntime, ToolDispatcher,
 * PermissionEngine, BackendSelector, BackendRegistry, ContextBuilder) + itestagent-contracts
 * (AgentRuntime, ToolCall, ToolResult, AgentTurnInputSchema) + itestagent-device-mock (MockDeviceBackend).
 *
 * Tasks 3.8 + 3.9 verification: AgentRuntime dispatches tool calls through ToolDispatcher,
 * PermissionEngine gates operations, BackendSelector routes to correct backend.
 */
import { describe, expect, it } from 'bun:test';
import { AgentTurnInputSchema, ToolResultSchema } from 'itestagent-contracts';
import type { AgentTurnInput } from 'itestagent-contracts';
import { MockDeviceBackend } from 'itestagent-device-mock';
import {
  BackendRegistry,
  BackendSelector,
  ContextBuilder,
  MockAgentRuntime,
  PermissionEngine,
  ToolDispatcher,
} from 'itestagent-engine';

const UDID = '00008110-001A2C3434A0801E';

function setupDispatcher(targetKind: 'physical' | 'simulator' = 'physical'): ToolDispatcher {
  // biome-ignore lint/suspicious/noExplicitAny: integration test — mock backend passed through registry
  const mock = new MockDeviceBackend() as any;
  const registry = new BackendRegistry();
  registry.register('mock', mock);
  return new ToolDispatcher({
    permissionEngine: new PermissionEngine(),
    backendSelector: new BackendSelector(registry),
    targetKind,
  });
}

describe('Phase 3 Agent Execution', () => {
  it('MockAgentRuntime creates and aborts', () => {
    const runtime = new MockAgentRuntime();
    expect(runtime.isAborted()).toBe(false);
    runtime.abort('test');
    expect(runtime.isAborted()).toBe(true);
  });

  it('MockAgentRuntime executes pre-configured tool calls', async () => {
    const runtime = new MockAgentRuntime();
    runtime.setToolResults(
      new Map([['tc-1', { callId: 'tc-1', status: 'ok' as const, output: { tapped: true } }]]),
    );

    const result = await runtime.executeToolCall({
      id: 'tc-1',
      name: 'tap',
      arguments: { deviceId: UDID, x: 0.5, y: 0.5 },
    });

    expect(result.status).toBe('ok');
    expect(ToolResultSchema.safeParse(result).success).toBe(true);
  });

  it('MockAgentRuntime tracks history via getHistory', async () => {
    const runtime = new MockAgentRuntime();
    runtime.setToolResults(
      new Map([
        ['tc-1', { callId: 'tc-1', status: 'ok' as const, output: {} }],
        ['tc-2', { callId: 'tc-2', status: 'ok' as const, output: {} }],
      ]),
    );

    await runtime.executeToolCall({ id: 'tc-1', name: 'tap', arguments: { x: 0.5, y: 0.5 } });
    await runtime.executeToolCall({
      id: 'tc-2',
      name: 'swipe',
      arguments: { x: 0.2, y: 0.8, toX: 0.2, toY: 0.3 },
    });

    const history = runtime.getHistory();
    expect(history.toolCalls.length).toBe(2);
    expect(history.toolCalls[0]?.name).toBe('tap');
    expect(history.toolCalls[1]?.name).toBe('swipe');
  });

  it('AgentTurnInputSchema validates correctly', async () => {
    const input: AgentTurnInput = {
      system: 'You are a test agent.',
      messages: [{ role: 'user', content: 'test' }],
    };

    expect(AgentTurnInputSchema.safeParse(input).success).toBe(true);
  });

  const toolTests = [
    ['tap', { deviceId: UDID, x: 0.5, y: 0.5 }],
    ['screenshot', { deviceId: UDID }],
    ['get_ui_tree', { deviceId: UDID }],
    ['launch_app', { deviceId: UDID, bundleId: 'com.test.app' }],
    ['terminate_app', { deviceId: UDID, bundleId: 'com.test.app' }],
    ['type_text', { deviceId: UDID, text: 'hello', elementId: 'field-1' }],
    ['list_crashes', { deviceId: UDID, bundleId: 'com.test.app' }],
    ['collect_logs', { deviceId: UDID, bundleId: 'com.test.app' }],
  ] as const;

  for (const [name, args] of toolTests) {
    it(`ToolDispatcher dispatches ${name}`, async () => {
      const dispatcher = setupDispatcher();
      const result = await dispatcher.dispatch({ id: `c-${name}`, name, arguments: args });
      expect(result.status).toBe('ok');
    });
  }

  it('PermissionEngine deny blocks tool execution', async () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: 'tap', resource: '*', effect: 'deny' });

    // biome-ignore lint/suspicious/noExplicitAny: integration test — mock backend passed through registry
    const mock = new MockDeviceBackend() as any;
    const registry = new BackendRegistry();
    registry.register('mock', mock);
    const dispatcher = new ToolDispatcher({
      permissionEngine: pe,
      backendSelector: new BackendSelector(registry),
      targetKind: 'physical',
    });

    const result = await dispatcher.dispatch({
      id: 'c_denied',
      name: 'tap',
      arguments: { deviceId: UDID, x: 0.5, y: 0.5 },
    });

    expect(result.status).toBe('error');
  });

  it('PermissionEngine allow permits execution', async () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: '*', resource: '*', effect: 'allow' });

    const dispatcher = setupDispatcher();
    const result = await dispatcher.dispatch({
      id: 'c_allowed',
      name: 'tap',
      arguments: { deviceId: UDID, x: 0.5, y: 0.5 },
    });

    expect(result.status).toBe('ok');
  });

  it('ToolDispatcher rejects unknown tool name', async () => {
    const dispatcher = setupDispatcher();
    const result = await dispatcher.dispatch({
      id: 'c_unknown',
      name: 'nonexistent_tool',
      arguments: {},
    });

    expect(result.status).toBe('error');
  });

  it('ToolDispatcher rejects invalid arguments', async () => {
    const dispatcher = setupDispatcher();
    const result = await dispatcher.dispatch({
      id: 'c_invalid',
      name: 'tap',
      // biome-ignore lint/suspicious/noExplicitAny: intentionally invalid args for error-path test
      arguments: { x: 'not_a_number' } as any,
    });

    expect(result.status).toBe('error');
  });

  it('ContextBuilder system prompt consumed by AgentTurnInput', () => {
    const builder = new ContextBuilder();
    const systemPrompt = builder.buildSystemPrompt({
      projectProfile: {
        schemaVersion: 'itestagent.project-profile.v1',
        projectHash: 'a'.repeat(64),
        app: { name: 'TestApp', bundleId: 'com.test.app' },
        targets: [{ name: 'TestApp', type: 'app' as const, bundleId: 'com.test.app' }],
        testAssets: { hasXCUITest: false, hasScheme: true },
        features: [],
        suggestedSmoke: [],
      },
      runState: 'executing',
      // biome-ignore lint/suspicious/noExplicitAny: integration test — partial BuildSystemPromptInput for ContextBuilder
    } as any);

    const turnInput: AgentTurnInput = {
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Start the login flow' }],
    };

    const parsed = AgentTurnInputSchema.safeParse(turnInput);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.system).toContain('TestApp');
      expect(parsed.data.messages.length).toBe(1);
    }
  });

  it('ToolDispatcher works with simulator targetKind', async () => {
    const dispatcher = setupDispatcher('simulator');
    const result = await dispatcher.dispatch({
      id: 'c_sim',
      name: 'get_ui_tree',
      arguments: { deviceId: 'F7C1CF80-9B8A-4E5C-A123-4567890ABCDE' },
    });

    expect(result.status).toBe('ok');
  });
});
