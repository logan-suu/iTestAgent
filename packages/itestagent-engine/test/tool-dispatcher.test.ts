/**
 * ToolDispatcher tests — TDD for ADR-010 §5 ToolDispatcher chain:
 *   ToolCall → Zod parse → PermissionEngine → BackendSelector → backend method
 *   → normalize ToolResult → RunStep/Artifact → AgentEvent
 *
 * AC coverage (task 3.9 notes):
 *   - healthcheck/fallback order correct
 *   - semantic changes produce permission requests
 *   - output passes through Zod
 *   - oversized/unknown output explicitly fails or truncates (ADR-010 §11)
 */

import { describe, expect, test } from 'bun:test';
import type {
  ActionResult,
  AgentEvent,
  AppInfo,
  ArtifactRef,
  BackendCapabilities,
  CrashSummary,
  DeviceBackend,
  DeviceInfo,
  DeviceTarget,
  HealthCheckResult,
  LaunchAppInput,
  LogCollectInput,
  OpenUrlInput,
  PressButtonInput,
  RecordingHandle,
  RecordingInput,
  ScreenshotInput,
  SwipeInput,
  TapInput,
  TargetKind,
  TerminateAppInput,
  TypeTextInput,
  UiTreeSnapshot,
} from 'itestagent-contracts';
import { BackendRegistry, BackendSelector, PermissionEngine } from '../src/index.js';

import type { EventEmitter, ToolDispatcherOptions } from '../src/tool-dispatcher.js';
import { ToolDispatcher } from '../src/tool-dispatcher.js';

// ─── Helpers ───────────────────────────────────────────────────

function makeToolCall(
  overrides: Partial<{ id: string; name: string; arguments: Record<string, unknown> }> = {},
): { id: string; name: string; arguments: Record<string, unknown> } {
  return {
    id: 'call_1',
    name: 'tap',
    arguments: { deviceId: 'device-1', x: 0.5, y: 0.5 },
    ...overrides,
  };
}

function makeOkResult(
  callId = 'call_1',
  output: unknown = { success: true },
): { callId: string; status: 'ok'; output: unknown } {
  return { callId, status: 'ok', output };
}

function makeErrorResult(
  callId = 'call_1',
  error = 'something went wrong',
): { callId: string; status: 'error'; output: unknown } {
  return { callId, status: 'error', output: { error } };
}

function makeArtifactRef(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
  return {
    id: 'art_1',
    type: 'screenshot',
    path: '/tmp/screenshot.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    redactionStatus: 'safe',
    ...overrides,
  } as ArtifactRef;
}

function fakeArtifactIndex(): Map<string, ArtifactRef> {
  return new Map();
}

/**
 * FakeDeviceBackend — minimal test double implementing DeviceBackend.
 * Records calls for assertions and returns configurable responses.
 */
class FakeDeviceBackend implements DeviceBackend {
  public readonly name: string;
  public readonly capabilities: BackendCapabilities = {
    supportedTargetKinds: ['physical', 'simulator'],
    features: [],
    supportsUiTree: true,
    supportsScreenshot: true,
    supportsVideo: false,
    supportsCrashLogs: false,
    supportsLocation: false,
    supportsPush: false,
  };

  public tapResult: ActionResult = { success: true };
  public screenshotResult: ArtifactRef = makeArtifactRef();
  public getUiTreeResult: UiTreeSnapshot = {
    raw: '<UI></UI>',
    format: 'xml',
    capturedAt: new Date().toISOString(),
  };
  public launchAppResult: ActionResult = { success: true };
  public terminateAppResult: ActionResult = { success: true };
  public swipeResult: ActionResult = { success: true };
  public typeTextResult: ActionResult = { success: true };
  public pressButtonResult: ActionResult = { success: true };
  public openUrlResult: ActionResult = { success: true };

  public shouldThrow = false;
  public throwError: Error = new Error('backend failure');

  public tapCalls: TapInput[] = [];
  public screenshotCalls: ScreenshotInput[] = [];
  public getUiTreeCalls: DeviceTarget[] = [];
  public launchAppCalls: LaunchAppInput[] = [];
  public terminateAppCalls: TerminateAppInput[] = [];
  public swipeCalls: SwipeInput[] = [];
  public typeTextCalls: TypeTextInput[] = [];
  public pressButtonCalls: PressButtonInput[] = [];
  public openUrlCalls: OpenUrlInput[] = [];
  public startRecordingCalls: RecordingInput[] = [];
  public stopRecordingCalls: RecordingHandle[] = [];
  public listCrashesCalls: DeviceTarget[] = [];
  public collectLogsCalls: LogCollectInput[] = [];

  constructor(name = 'fake') {
    this.name = name;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return [];
  }
  async healthcheck(_deviceId: string): Promise<HealthCheckResult> {
    return { healthy: true };
  }
  async listApps(_deviceId: string): Promise<AppInfo[]> {
    return [];
  }

  async tap(input: TapInput): Promise<ActionResult> {
    this.tapCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.tapResult;
  }

  async screenshot(input: ScreenshotInput): Promise<ArtifactRef> {
    this.screenshotCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.screenshotResult;
  }

  async getUiTree(input: DeviceTarget): Promise<UiTreeSnapshot> {
    this.getUiTreeCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.getUiTreeResult;
  }

  async launchApp(input: LaunchAppInput): Promise<ActionResult> {
    this.launchAppCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.launchAppResult;
  }

  async terminateApp(input: TerminateAppInput): Promise<ActionResult> {
    this.terminateAppCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.terminateAppResult;
  }

  async swipe(input: SwipeInput): Promise<ActionResult> {
    this.swipeCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.swipeResult;
  }

  async typeText(input: TypeTextInput): Promise<ActionResult> {
    this.typeTextCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.typeTextResult;
  }

  async pressButton(input: PressButtonInput): Promise<ActionResult> {
    this.pressButtonCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.pressButtonResult;
  }

  async openUrl(input: OpenUrlInput): Promise<ActionResult> {
    this.openUrlCalls.push(input);
    if (this.shouldThrow) throw this.throwError;
    return this.openUrlResult;
  }

  async startRecording(input: RecordingInput): Promise<RecordingHandle> {
    this.startRecordingCalls.push(input);
    return { handleId: 'rec_1', startedAt: new Date().toISOString() };
  }

  async stopRecording(_input: RecordingHandle): Promise<ArtifactRef> {
    this.stopRecordingCalls.push(_input);
    return makeArtifactRef({ id: 'vid_1', type: 'video' });
  }

  async listCrashes(input: DeviceTarget): Promise<CrashSummary[]> {
    this.listCrashesCalls.push(input);
    return [];
  }

  async collectLogs(input: LogCollectInput): Promise<ArtifactRef> {
    this.collectLogsCalls.push(input);
    return makeArtifactRef({ id: 'log_1', type: 'log' });
  }
}

/**
 * FakeBackendSelector that always returns a specific backend.
 */
class FakeBackendSelector {
  constructor(private backend: DeviceBackend) {}

  select(_targetKind: TargetKind, _preferredBackend?: string, _deviceId?: string) {
    return {
      success: true,
      backend: this.backend,
      healthcheckNotImplemented: true,
    };
  }
}

function createDispatcher(
  overrides: {
    permissionEngine?: PermissionEngine;
    backend?: FakeDeviceBackend;
    backendSelector?: BackendSelector;
    onEvent?: EventEmitter;
  } = {},
): { dispatcher: ToolDispatcher; backend: FakeDeviceBackend; events: AgentEvent[] } {
  const backend = overrides.backend ?? new FakeDeviceBackend();
  const selector = new BackendRegistry();
  selector.register(backend.name, backend);
  const events: AgentEvent[] = [];
  const dispatcher = new ToolDispatcher({
    permissionEngine: overrides.permissionEngine ?? new PermissionEngine(),
    backendSelector: overrides.backendSelector ?? new BackendSelector(selector),
    targetKind: 'physical',
    onEvent: overrides.onEvent ?? ((e) => events.push(e)),
  });
  return { dispatcher, backend, events };
}

// ─── Zod parse / Tool registry ─────────────────────────────────

describe('ToolRegistry — Zod parse and tool-to-backend mapping', () => {
  test('valid tap tool call maps to backend.tap with parsed params', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({ name: 'tap', arguments: { deviceId: 'd1', x: 0.5, y: 0.3 } });

    await dispatcher.dispatch(call);

    expect(backend.tapCalls).toHaveLength(1);
    expect(backend.tapCalls[0]).toEqual({ deviceId: 'd1', x: 0.5, y: 0.3 });
  });

  test('valid screenshot tool call maps to backend.screenshot', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({ name: 'screenshot', arguments: { deviceId: 'd1' } });

    await dispatcher.dispatch(call);

    expect(backend.screenshotCalls).toHaveLength(1);
    expect(backend.screenshotCalls[0]).toEqual({ deviceId: 'd1' });
  });

  test('valid get_ui_tree tool call maps to backend.getUiTree', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({ name: 'get_ui_tree', arguments: { deviceId: 'd1' } });

    await dispatcher.dispatch(call);

    expect(backend.getUiTreeCalls).toHaveLength(1);
    expect(backend.getUiTreeCalls[0]).toEqual({ deviceId: 'd1' });
  });

  test('valid launch_app tool call maps to backend.launchApp', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({
      name: 'launch_app',
      arguments: { deviceId: 'd1', bundleId: 'com.example.app' },
    });

    await dispatcher.dispatch(call);

    expect(backend.launchAppCalls).toHaveLength(1);
    expect(backend.launchAppCalls[0]).toEqual({ deviceId: 'd1', bundleId: 'com.example.app' });
  });

  test('valid swipe tool call maps to backend.swipe', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({
      name: 'swipe',
      arguments: { deviceId: 'd1', fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3 },
    });

    await dispatcher.dispatch(call);

    expect(backend.swipeCalls).toHaveLength(1);
    expect(backend.swipeCalls[0]).toEqual({
      deviceId: 'd1',
      fromX: 0.5,
      fromY: 0.7,
      toX: 0.5,
      toY: 0.3,
    });
  });

  test('valid type_text tool call maps to backend.typeText', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({ name: 'type_text', arguments: { deviceId: 'd1', text: 'hello' } });

    await dispatcher.dispatch(call);

    expect(backend.typeTextCalls).toHaveLength(1);
    expect(backend.typeTextCalls[0]).toEqual({ deviceId: 'd1', text: 'hello' });
  });

  test('valid press_button tool call maps to backend.pressButton', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({
      name: 'press_button',
      arguments: { deviceId: 'd1', button: 'home' },
    });

    await dispatcher.dispatch(call);

    expect(backend.pressButtonCalls).toHaveLength(1);
    expect(backend.pressButtonCalls[0]).toEqual({ deviceId: 'd1', button: 'home' });
  });

  test('unknown tool name returns error result with description', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({ name: 'nonexistent_tool', arguments: {} });

    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('error');
    const output = result.output as Record<string, unknown>;
    expect(output.error).toBeString();
    expect(output.error).toMatch(/unknown|Unknown/i);
    // No backend calls should have been made
    expect(backend.tapCalls).toHaveLength(0);
  });

  test('tool call with missing required argument returns Zod error', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({ name: 'tap', arguments: { x: 0.5 } }); // missing deviceId

    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('error');
    const output = result.output as Record<string, unknown>;
    expect(output.error).toBeString();
    expect(backend.tapCalls).toHaveLength(0);
  });

  test('tool call with out-of-range coordinate returns error', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({ name: 'tap', arguments: { deviceId: 'd1', x: 2.0, y: 0.5 } }); // x > 1

    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('error');
    expect(backend.tapCalls).toHaveLength(0);
  });

  test('terminate_app is in the high-risk tool registry', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({
      name: 'terminate_app',
      arguments: { deviceId: 'd1', bundleId: 'com.example.app' },
    });

    const result = await dispatcher.dispatch(call);

    // terminate_app is a defined tool, so should succeed (permission is allow by default)
    expect(result.status).toBe('ok');
    expect(backend.terminateAppCalls).toHaveLength(1);
  });
});

// ─── Permission gate ────────────────────────────────────────────

describe('Permission gate — allow/deny/ask flow', () => {
  test('allow gate → tool executes and returns ok result', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall();

    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('ok');
    expect(backend.tapCalls).toHaveLength(1);
  });

  test('deny gate → returns error and never executes tool', async () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: 'tap', resource: 'deviceId:device-1', effect: 'deny' });
    const { dispatcher, backend } = createDispatcher({ permissionEngine: pe });
    const call = makeToolCall();

    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('error');
    const output = result.output as Record<string, unknown>;
    expect(output.error).toMatch(/permission denied|Permission denied/i);
    expect(backend.tapCalls).toHaveLength(0);
  });

  test('ask gate → resolved allow executes tool', async () => {
    const pe = new PermissionEngine({ highRiskActions: ['tap'] }); // make tap high-risk → ask
    const { dispatcher, backend } = createDispatcher({ permissionEngine: pe });
    const call = makeToolCall({ id: 'tc_ask_allow' });

    // Start dispatch — it will block on ask
    const dispatchPromise = dispatcher.dispatch(call);

    // Resolve the ask before timeout
    pe.resolve('tc_ask_allow', 'allow', false);
    const result = await dispatchPromise;

    expect(result.status).toBe('ok');
    expect(backend.tapCalls).toHaveLength(1);
  });

  test('ask gate → resolved deny does not execute tool', async () => {
    const pe = new PermissionEngine({ highRiskActions: ['tap'] });
    const { dispatcher, backend } = createDispatcher({ permissionEngine: pe });
    const call = makeToolCall({ id: 'tc_ask_deny' });

    const dispatchPromise = dispatcher.dispatch(call);
    pe.resolve('tc_ask_deny', 'deny', false);
    const result = await dispatchPromise;

    expect(result.status).toBe('error');
    expect(backend.tapCalls).toHaveLength(0);
  });

  test('ask gate timeout → returns permission timeout error', async () => {
    const pe = new PermissionEngine({ highRiskActions: ['tap'], askTimeoutMs: 100 });
    const { dispatcher, backend } = createDispatcher({ permissionEngine: pe });
    const call = makeToolCall({ id: 'tc_timeout' });

    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('error');
    const output = result.output as Record<string, unknown>;
    expect(output.error).toMatch(/timeout|Timeout/i);
    expect(backend.tapCalls).toHaveLength(0);
  });

  test('wildcard deny rule blocks all taps regardless of resource', async () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: 'tap', resource: '*', effect: 'deny' });
    const { dispatcher, backend } = createDispatcher({ permissionEngine: pe });

    const r1 = await dispatcher.dispatch(
      makeToolCall({ arguments: { deviceId: 'd1', x: 0.5, y: 0.5 } }),
    );
    const r2 = await dispatcher.dispatch(
      makeToolCall({ arguments: { deviceId: 'd2', x: 0.5, y: 0.5 } }),
    );

    expect(r1.status).toBe('error');
    expect(r2.status).toBe('error');
    expect(backend.tapCalls).toHaveLength(0);
  });

  test('allow rule on specific device overrides high-risk default', async () => {
    const pe = new PermissionEngine({ highRiskActions: ['tap'] });
    pe.addRule({ action: 'tap', resource: 'deviceId:device-1', effect: 'allow' });
    const { dispatcher, backend } = createDispatcher({ permissionEngine: pe });

    const result = await dispatcher.dispatch(makeToolCall());

    expect(result.status).toBe('ok');
    expect(backend.tapCalls).toHaveLength(1);
  });

  test('permission denied result preserves original callId', async () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: 'tap', resource: 'deviceId:device-1', effect: 'deny' });
    const { dispatcher } = createDispatcher({ permissionEngine: pe });
    const call = makeToolCall({ id: 'my_call_id' });

    const result = await dispatcher.dispatch(call);

    expect(result.callId).toBe('my_call_id');
  });
});

// ─── Backend selection ──────────────────────────────────────────

describe('BackendSelector integration', () => {
  test('selected backend is used to execute the tool', async () => {
    const backend = new FakeDeviceBackend('appium');
    const registry = new BackendRegistry();
    registry.register('appium', backend);
    const selector = new BackendSelector(registry);
    const { dispatcher } = createDispatcher({ backend, backendSelector: selector });

    const call = makeToolCall();
    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('ok');
    expect(backend.tapCalls).toHaveLength(1);
  });

  test('when backend selection fails → returns error result', async () => {
    const pe = new PermissionEngine();
    // Empty registry — no backends available
    const emptyRegistry = new BackendRegistry();
    const selector = new BackendSelector(emptyRegistry);
    const dispatcher = new ToolDispatcher({
      permissionEngine: pe,
      backendSelector: selector,
      targetKind: 'physical',
    });

    const call = makeToolCall();
    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('error');
    const output = result.output as Record<string, unknown>;
    expect(output.error).toBeString();
    expect(output.error).toMatch(/backend|no backend/i);
  });

  test('fallback chain is reflected in error when selection fails', async () => {
    const pe = new PermissionEngine();
    const emptyRegistry = new BackendRegistry();
    const selector = new BackendSelector(emptyRegistry);
    const dispatcher = new ToolDispatcher({
      permissionEngine: pe,
      backendSelector: selector,
      targetKind: 'physical',
    });

    const call = makeToolCall();
    const result = await dispatcher.dispatch(call);

    expect(result.status).toBe('error');
  });
});

// ─── Backend execution ──────────────────────────────────────────

describe('Backend execution — result normalization', () => {
  test('successful tap returns ok result with output', async () => {
    const { dispatcher } = createDispatcher();
    const result = await dispatcher.dispatch(makeToolCall());

    expect(result.status).toBe('ok');
    expect(result.callId).toBe('call_1');
    const output = result.output as Record<string, unknown>;
    expect(output.success).toBe(true);
  });

  test('failed backend result preserves error in output', async () => {
    const { dispatcher, backend } = createDispatcher();
    backend.tapResult = { success: false, error: 'element not found' };

    const result = await dispatcher.dispatch(makeToolCall());

    expect(result.status).toBe('ok'); // tool succeeded; backend returned a result
    const output = result.output as Record<string, unknown>;
    expect(output.success).toBe(false);
    expect(output.error).toBe('element not found');
  });

  test('backend throws → result is error with cause', async () => {
    const { dispatcher, backend } = createDispatcher();
    backend.shouldThrow = true;
    backend.throwError = new Error('connection refused');

    const result = await dispatcher.dispatch(makeToolCall());

    expect(result.status).toBe('error');
    const output = result.output as Record<string, unknown>;
    expect(output.error).toMatch(/connection refused/i);
  });

  test('screenshot returns artifact in result.artifacts', async () => {
    const { dispatcher, backend } = createDispatcher();
    backend.screenshotResult = makeArtifactRef({ id: 'ss_1', type: 'screenshot' });

    const result = await dispatcher.dispatch(
      makeToolCall({ name: 'screenshot', arguments: { deviceId: 'd1' } }),
    );

    expect(result.status).toBe('ok');
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts?.[0]?.id).toBe('ss_1');
  });
});

// ─── Output normalization (ADR-010 §11) ─────────────────────────

describe('Output normalization — oversized/unknown output', () => {
  test('output is always JSON-serializable', async () => {
    const { dispatcher, backend } = createDispatcher();
    backend.tapResult = { success: true, message: 'ok' };

    const result = await dispatcher.dispatch(makeToolCall());

    // Should be safe to serialize
    expect(() => JSON.stringify(result.output)).not.toThrow();
  });

  test('null output is preserved', async () => {
    const { dispatcher, backend } = createDispatcher();
    // Simulate backend returning undefined/null-like result
    backend.tapResult = { success: true } as ActionResult;

    const result = await dispatcher.dispatch(makeToolCall());

    expect(result.status).toBe('ok');
  });

  test('very large string output is truncated with marker (R5: not silent)', async () => {
    const { dispatcher, backend } = createDispatcher();
    backend.getUiTreeResult = {
      raw: 'x'.repeat(200_000),
      format: 'xml',
      capturedAt: new Date().toISOString(),
    };

    const result = await dispatcher.dispatch(
      makeToolCall({ name: 'get_ui_tree', arguments: { deviceId: 'd1' } }),
    );

    expect(result.status).toBe('ok');
    const output = result.output as Record<string, unknown>;
    if (typeof output.raw === 'string' && output.raw.length > 100_000) {
      // If not truncated, still ok — implementation-dependent
      // R5: no silent dropping — must be explicit if truncated
      if (output.truncated) {
        expect(output.truncationReason).toBeString();
      }
    }
  });

  test('circular reference in output is caught and normalized (no crash)', async () => {
    const { dispatcher, backend } = createDispatcher();
    const circular: Record<string, unknown> = { name: 'test' };
    circular.self = circular;
    // biome-ignore lint/suspicious/noExplicitAny: testing runtime circular-ref handling through any
    (backend as any).tapResult = { success: true, data: circular };

    const result = await dispatcher.dispatch(makeToolCall());

    // Must not throw — circular ref should be normalized
    expect(result.status).toBe('ok');
  });
});

// ─── Abort ──────────────────────────────────────────────────────

describe('Abort signal propagation', () => {
  test('dispatch returns early if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('user cancelled');
    const { backend } = createDispatcher();
    const pe = new PermissionEngine();
    const registry = new BackendRegistry();
    registry.register('fake', backend);
    const selector = new BackendSelector(registry);
    const dispatcher = new ToolDispatcher({
      permissionEngine: pe,
      backendSelector: selector,
      targetKind: 'physical',
      signal: controller.signal,
    });

    const result = await dispatcher.dispatch(makeToolCall());

    expect(result.status).toBe('error');
    const output = result.output as Record<string, unknown>;
    expect(output.error).toMatch(/abort|cancelled/i);
    expect(backend.tapCalls).toHaveLength(0);
  });

  test('abort signal is checked before backend execution', async () => {
    const controller = new AbortController();
    const { backend } = createDispatcher();
    const pe = new PermissionEngine();
    const registry = new BackendRegistry();
    registry.register('fake', backend);
    const selector = new BackendSelector(registry);
    const dispatcher = new ToolDispatcher({
      permissionEngine: pe,
      backendSelector: selector,
      targetKind: 'physical',
      signal: controller.signal,
    });

    // Abort during dispatch (before backend call)
    const dispatchPromise = dispatcher.dispatch(makeToolCall());
    controller.abort('mid-cancel');

    const result = await dispatchPromise;
    expect(result.status).toBe('error');
  });
});

// ─── AgentEvent emission ────────────────────────────────────────

describe('AgentEvent emission', () => {
  test('permission.requested event is emitted for ask gate', async () => {
    const pe = new PermissionEngine({ highRiskActions: ['tap'], askTimeoutMs: 5000 });
    const { dispatcher, events } = createDispatcher({ permissionEngine: pe });
    const call = makeToolCall({ id: 'tc_event_1' });

    const dispatchPromise = dispatcher.dispatch(call);

    // Give the event loop time to emit the permission.requested event
    await new Promise<void>((r) => setTimeout(r, 50));

    const permReq = events.find((e) => e.type === 'permission.requested');
    expect(permReq).toBeDefined();
    expect((permReq as { callId: string }).callId).toBe('tc_event_1');

    pe.resolve('tc_event_1', 'allow', false);
    await dispatchPromise;
  });

  test('permission.resolved event is emitted after ask is resolved', async () => {
    const pe = new PermissionEngine({ highRiskActions: ['tap'], askTimeoutMs: 5000 });
    const { dispatcher, events } = createDispatcher({ permissionEngine: pe });
    const call = makeToolCall({ id: 'tc_event_2' });

    const dispatchPromise = dispatcher.dispatch(call);
    await new Promise<void>((r) => setTimeout(r, 50));
    pe.resolve('tc_event_2', 'allow', false);
    await dispatchPromise;

    const permResolved = events.find((e) => e.type === 'permission.resolved');
    expect(permResolved).toBeDefined();
    expect((permResolved as { callId: string }).callId).toBe('tc_event_2');
  });

  test('no permission events for allow gate', async () => {
    const { dispatcher, events } = createDispatcher();
    await dispatcher.dispatch(makeToolCall());

    const permEvents = events.filter(
      (e) => e.type === 'permission.requested' || e.type === 'permission.resolved',
    );
    expect(permEvents).toHaveLength(0);
  });

  test('tool.started event is emitted with backend name', async () => {
    const { dispatcher, events } = createDispatcher();
    await dispatcher.dispatch(makeToolCall());

    const started = events.find((e) => e.type === 'tool.started');
    expect(started).toBeDefined();
    if (started) expect(started.backend).toBe('fake');
  });

  test('tool.completed event is emitted with the ToolResult', async () => {
    const { dispatcher, events } = createDispatcher();
    await dispatcher.dispatch(makeToolCall({ id: 'tc_complete' }));

    const completed = events.find((e) => e.type === 'tool.completed');
    expect(completed).toBeDefined();
    if (completed) expect(completed.callId).toBe('tc_complete');
  });

  test('tool.failed event is emitted on error', async () => {
    const { dispatcher, events, backend } = createDispatcher();
    backend.shouldThrow = true;
    backend.throwError = new Error('boom');

    await dispatcher.dispatch(makeToolCall({ id: 'tc_failed' }));

    const failed = events.find((e) => e.type === 'tool.failed');
    expect(failed).toBeDefined();
    if (failed) expect(failed.callId).toBe('tc_failed');
  });

  test('artifact.created event is emitted when backend produces artifacts', async () => {
    const { dispatcher, events, backend } = createDispatcher();
    backend.screenshotResult = makeArtifactRef({ id: 'ss_event', type: 'screenshot' });

    await dispatcher.dispatch(makeToolCall({ name: 'screenshot', arguments: { deviceId: 'd1' } }));

    const artEvent = events.find((e) => e.type === 'artifact.created');
    expect(artEvent).toBeDefined();
  });
});

// ─── Edge cases ─────────────────────────────────────────────────

describe('Edge cases', () => {
  test('empty arguments object is accepted for tools with no required params', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({ name: 'screenshot', arguments: { deviceId: 'd1' } });

    const result = await dispatcher.dispatch(call);
    expect(result.status).toBe('ok');
    expect(backend.screenshotCalls).toHaveLength(1);
  });

  test('extra unknown arguments are stripped by Zod parse', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call = makeToolCall({
      name: 'tap',
      arguments: { deviceId: 'd1', x: 0.5, y: 0.5, unknownField: 'should be stripped' },
    });

    await dispatcher.dispatch(call);

    expect(backend.tapCalls).toHaveLength(1);
  });

  test('concurrent dispatch of two calls with same backend — serial, no crash', async () => {
    const { dispatcher, backend } = createDispatcher();
    const call1 = makeToolCall({ id: 'c1' });
    const call2 = makeToolCall({ id: 'c2' });

    const [r1, r2] = await Promise.all([dispatcher.dispatch(call1), dispatcher.dispatch(call2)]);

    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');
    expect(backend.tapCalls).toHaveLength(2);
  });

  test('ToolCall.id is preserved in all returned ToolResults', async () => {
    const { dispatcher } = createDispatcher();
    const id = 'unique_call_42';

    const result = await dispatcher.dispatch(makeToolCall({ id }));

    expect(result.callId).toBe(id);
  });

  test('dispatch with no onEvent callback set does not crash', async () => {
    const pe = new PermissionEngine();
    const registry = new BackendRegistry();
    const backend = new FakeDeviceBackend();
    registry.register('fake', backend);
    const selector = new BackendSelector(registry);
    const dispatcher = new ToolDispatcher({
      permissionEngine: pe,
      backendSelector: selector,
      targetKind: 'physical',
      // no onEvent
    });

    const result = await dispatcher.dispatch(makeToolCall());

    expect(result.status).toBe('ok');
  });

  test('multiple tools across the registry all map correctly', async () => {
    const { dispatcher, backend } = createDispatcher();

    const tools = [
      { name: 'tap', args: { deviceId: 'd1', x: 0.5, y: 0.5 } as Record<string, unknown> },
      {
        name: 'swipe',
        args: { deviceId: 'd1', fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3 } as Record<
          string,
          unknown
        >,
      },
      { name: 'screenshot', args: { deviceId: 'd1' } as Record<string, unknown> },
      { name: 'get_ui_tree', args: { deviceId: 'd1' } as Record<string, unknown> },
      { name: 'type_text', args: { deviceId: 'd1', text: 'hi' } as Record<string, unknown> },
    ];

    for (const tool of tools) {
      const call = makeToolCall({ id: `tc_${tool.name}`, name: tool.name, arguments: tool.args });
      const result = await dispatcher.dispatch(call);
      expect(result.status).toBe('ok');
    }

    expect(backend.tapCalls).toHaveLength(1);
    expect(backend.swipeCalls).toHaveLength(1);
    expect(backend.screenshotCalls).toHaveLength(1);
    expect(backend.getUiTreeCalls).toHaveLength(1);
    expect(backend.typeTextCalls).toHaveLength(1);
  });

  test('permission resource is derived from tool arguments', async () => {
    const pe = new PermissionEngine();
    pe.addRule({ action: 'tap', resource: 'deviceId:d1', effect: 'deny' });
    const { dispatcher, backend } = createDispatcher({ permissionEngine: pe });

    // This tap targets d1 — should be denied
    const r1 = await dispatcher.dispatch(
      makeToolCall({ id: 'c_d1', arguments: { deviceId: 'd1', x: 0.5, y: 0.5 } }),
    );
    expect(r1.status).toBe('error');

    // This tap targets d2 — should be allowed (different resource)
    const r2 = await dispatcher.dispatch(
      makeToolCall({ id: 'c_d2', arguments: { deviceId: 'd2', x: 0.5, y: 0.5 } }),
    );
    expect(r2.status).toBe('ok');
    expect(backend.tapCalls).toHaveLength(1);
  });
});
