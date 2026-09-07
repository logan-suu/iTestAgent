import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as aiReal from 'ai';
import type { DeviceBackend, DeviceInfo, TestPlan } from 'itestagent-contracts';
import type {
  AgentSessionDependencies,
  TuiAgentSession,
  TuiStatePatch,
} from '../src/agent-session.js';

interface SdkTool {
  execute(args: unknown, options: { toolCallId: string }): Promise<unknown>;
}

interface StreamArgs {
  model: unknown;
  messages: unknown[];
  system?: string;
  tools: Record<string, SdkTool>;
}

type StreamScenario = (args: StreamArgs) => AsyncIterable<Record<string, unknown>>;

let capturedStreamArgs: StreamArgs | null = null;
let streamScenario: StreamScenario = async function* () {};

mock.module('ai', () => ({
  ...aiReal,
  streamText: (args: StreamArgs) => {
    capturedStreamArgs = args;
    return { fullStream: streamScenario(args) };
  },
  stepCountIs: (count: number) => ({ count }),
  tool: (definition: Record<string, unknown>) => definition,
}));

const PHYSICAL_DEVICE: DeviceInfo = {
  udid: 'physical-udid',
  name: 'Developer iPhone',
  osVersion: '18.0',
  platform: 'ios',
  targetKind: 'physical',
  availability: 'ready',
};

const SIMULATOR_DEVICE: DeviceInfo = {
  udid: 'simulator-udid',
  name: 'iPhone 16 Pro',
  osVersion: '18.0',
  platform: 'ios',
  targetKind: 'simulator',
  state: 'booted',
  availability: 'ready',
};

const FAKE_ANALYSIS = {
  profile: {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'a'.repeat(64),
    app: {
      name: 'Demo',
      bundleId: 'com.example.Demo',
      workspace: '/workspace/Demo.xcworkspace',
      scheme: 'Demo',
    },
    targets: [{ name: 'Demo', type: 'app' }],
    testAssets: { hasXCUITest: false, hasScheme: true },
    features: [
      {
        name: 'Login',
        keywords: ['login', '登录'],
        evidence: ['LoginViewController.swift'],
        confidence: 0.8,
        confirmed: false,
        displayOrder: 0,
      },
    ],
    suggestedSmoke: ['launch', 'Login'],
  },
  analysis: {
    analysisTier: 'tier1_static',
    enabledCapabilities: ['xcodebuild_discovery', 'static_source_candidates'],
    limitations: ['Candidates require user confirmation.'],
    executionAssets: {
      statusByTargetKind: { physical: 'none', simulator: 'none' },
      configurations: [],
      evidence: ['Shared scheme metadata contains no XCUITest candidate.'],
      limitations: [],
    },
  },
} as const;

const FAKE_MODEL = {
  specificationVersion: 'v2',
  provider: 'itestagent-test',
  modelId: 'fake-model',
};

let createAgentSession: typeof import('../src/agent-session.js').createAgentSession;
let selectConfirmedPlanDevice: typeof import('../src/agent-session.js').selectConfirmedPlanDevice;

function dependencies(overrides: Partial<AgentSessionDependencies> = {}): AgentSessionDependencies {
  return {
    loadApiKey: async () => 'test-key',
    createModel: () => FAKE_MODEL as never,
    analyzeWorkspace: async () => FAKE_ANALYSIS as never,
    listDevices: async () => [PHYSICAL_DEVICE, SIMULATOR_DEVICE],
    waitForDeviceRefresh: async () => {},
    createDeviceBackend: () => ({ name: 'appium' }) as DeviceBackend,
    ...overrides,
  };
}

function confirmedFakeCandidates() {
  return FAKE_ANALYSIS.profile.features.map((candidate) => ({
    ...candidate,
    keywords: [...candidate.keywords],
    evidence: [...candidate.evidence],
    confirmed: true,
  }));
}

async function collectPatches(session: TuiAgentSession): Promise<TuiStatePatch[]> {
  return collectMessagePatches(session, 'inspect the workspace');
}

async function collectMessagePatches(
  session: TuiAgentSession,
  input: string,
): Promise<TuiStatePatch[]> {
  const patches: TuiStatePatch[] = [];
  for await (const patch of session.processMessage(input)) patches.push(patch);
  return patches;
}

async function enterModelTurn(
  session: TuiAgentSession,
  input = 'inspect the current session',
): Promise<TuiStatePatch[]> {
  await collectMessagePatches(session, '用本机 iPhone 跑登录 smoke');
  return collectMessagePatches(session, input);
}

function sdkTool(name: string): SdkTool {
  const tool = capturedStreamArgs?.tools[name];
  if (!tool) throw new Error(`SDK tool was not registered: ${name}`);
  return tool;
}

async function nextPatchOfType(
  iterator: AsyncIterator<TuiStatePatch>,
  type: TuiStatePatch['type'],
): Promise<TuiStatePatch> {
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error(`Patch stream ended before ${type}`);
    if (next.value.type === type) return next.value;
  }
}

beforeEach(async () => {
  capturedStreamArgs = null;
  streamScenario = async function* () {};
  ({ createAgentSession, selectConfirmedPlanDevice } = await import('../src/agent-session.js'));
});

describe('confirmed-plan target selection', () => {
  it('selects only the target named by the confirmed plan', () => {
    const otherPhysical = { ...PHYSICAL_DEVICE, udid: 'other-udid', name: 'Other iPhone' };
    const plan = {
      device: {
        kind: 'physical',
        physical: { selector: 'by_udid', udid: PHYSICAL_DEVICE.udid },
      },
    } as TestPlan;

    expect(selectConfirmedPlanDevice(plan, [otherPhysical, PHYSICAL_DEVICE])).toEqual(
      PHYSICAL_DEVICE,
    );
  });

  it('blocks when a confirmed selector still matches multiple targets', () => {
    const duplicateName = { ...PHYSICAL_DEVICE, udid: 'other-udid' };
    const plan = {
      device: {
        kind: 'physical',
        physical: { selector: 'by_name', name: PHYSICAL_DEVICE.name },
      },
    } as TestPlan;

    expect(() => selectConfirmedPlanDevice(plan, [PHYSICAL_DEVICE, duplicateName])).toThrow(
      'device_selection_required',
    );
  });

  it('does not silently create a Simulator requested by profile', () => {
    const plan = {
      device: {
        kind: 'simulator',
        simulator: { selector: 'create_from_profile' },
      },
    } as TestPlan;

    expect(() => selectConfirmedPlanDevice(plan, [SIMULATOR_DEVICE])).toThrow(
      'no_device_available',
    );
  });
});

describe('createAgentSession production composition', () => {
  it('fails closed before discovery when the API key is unavailable', async () => {
    let discoveryCalled = false;
    const error = await createAgentSession(
      '/workspace',
      dependencies({
        loadApiKey: async () => null,
        listDevices: async () => {
          discoveryCalled = true;
          return [];
        },
      }),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('No API key found');
    expect(discoveryCalled).toBe(false);
  });

  it('exposes discovered targets without constructing a backend before selection', async () => {
    const bound: DeviceInfo[] = [];
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        createDeviceBackend: (device) => {
          bound.push(device);
          return { name: 'appium' } as DeviceBackend;
        },
      }),
    );

    expect(session.getDevices()).toEqual([PHYSICAL_DEVICE, SIMULATOR_DEVICE]);
    expect(bound).toEqual([]);
    expect(typeof session.resolvePermission).toBe('function');
    expect(typeof session.cancelPermission).toBe('function');
  });

  it('does not silently select a Simulator when no physical device exists', async () => {
    let backendCreated = false;
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        listDevices: async () => [SIMULATOR_DEVICE],
        createDeviceBackend: () => {
          backendCreated = true;
          return { name: 'appium' } as DeviceBackend;
        },
      }),
    );

    expect(session.getDevices()).toEqual([SIMULATOR_DEVICE]);
    expect(backendCreated).toBe(false);
  });

  it('starts with an explicit failed discovery result instead of treating it as no device', async () => {
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        listDevices: async () => ({
          devices: [],
          status: 'failed',
          issues: [
            { lane: 'physical', code: 'command_failed', message: 'devicectl unavailable' },
            { lane: 'simulator', code: 'command_failed', message: 'simctl unavailable' },
          ],
        }),
      }),
    );

    const patches = await collectPatches(session);
    expect(patches[0]).toMatchObject({
      type: 'devices_update',
      payload: { discoveryStatus: 'failed' },
    });
    expect(patches[1]?.payload.text).toContain('devicectl unavailable');
  });

  it('sanitizes provider authentication errors before emitting a TUI patch', async () => {
    streamScenario = async function* () {
      yield {
        type: 'error',
        error: new Error('Authentication Fails, Your api key: ****1234 is invalid'),
      };
    };
    const session = await createAgentSession('/workspace', dependencies());

    const patches = await enterModelTurn(session);
    const error = patches.find((patch) => patch.type === 'error');
    expect(error?.payload.message).toBe(
      'Provider authentication failed. Re-enter an API key issued for the configured endpoint.',
    );
    expect(error?.payload.message).not.toContain('1234');
  });
});

describe('AgentSession tools', () => {
  it('requires explicit selection and rejects a paired but disconnected physical target', async () => {
    const offline = { ...PHYSICAL_DEVICE, udid: 'offline', availability: 'discovered' as const };
    const session = await createAgentSession(
      '/workspace',
      dependencies({ listDevices: async () => [offline, SIMULATOR_DEVICE] }),
    );
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    const patches = session.confirmCandidates(confirmedFakeCandidates());
    expect(patches.map((patch) => patch.type)).toContain('device_selection_request');
    expect(() => session.confirmPlan()).toThrow('device_selection_required');
    const rejected = await session.selectDevice(offline.udid);
    expect(rejected.find((patch) => patch.type === 'error')?.payload.message).toContain(
      'device_not_ready',
    );
    expect(rejected.some((patch) => patch.type === 'device_selection_request')).toBe(true);
  });

  it('writes the selected ready target into the draft plan before review', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    const patches = await session.selectDevice(PHYSICAL_DEVICE.udid);
    const planPatch = patches.find((patch) => patch.type === 'plan_update');
    expect(planPatch?.payload.plan).toMatchObject({
      device: {
        kind: 'physical',
        physical: { selector: 'by_udid', udid: PHYSICAL_DEVICE.udid },
      },
    });
    expect(patches.some((patch) => patch.payload.mode === 'plan_review')).toBe(true);
  });

  it('dispatches the exact confirmed v3 plan instead of returning the task 6.5 placeholder', async () => {
    const dispatched: Array<{ runId: string; device: string; signal?: AbortSignal }> = [];
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        executeConfirmedPlan: async ({ plan, device, signal }) => {
          dispatched.push({ runId: plan.runId, device: device.udid, signal });
          return { status: 'completed', path: plan.execution.resolvedPath };
        },
      }),
    );
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    await session.selectDevice(PHYSICAL_DEVICE.udid);
    const confirmed = session.confirmPlan();
    expect(confirmed.some((patch) => patch.payload.confirmed === true)).toBe(true);

    const executionPatches: TuiStatePatch[] = [];
    const permissionActions: string[] = [];
    for await (const patch of session.executeConfirmedPlan()) {
      executionPatches.push(patch);
      if (patch.type === 'permission_request') {
        permissionActions.push(String(patch.payload.action));
        await session.resolvePermission(String(patch.payload.callId), 'allow');
      }
    }
    expect(permissionActions).toEqual(['execute_project_build', 'replace_device_app']);
    expect(
      executionPatches.some(
        (patch) => patch.type === 'message_add' && patch.payload.text === 'Execution completed.',
      ),
    ).toBe(true);
    expect(dispatched[0]).toMatchObject({
      runId: session.getConfirmedPlan()?.runId as string,
      device: PHYSICAL_DEVICE.udid,
    });
    expect(dispatched[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('streams confirmed execution stages and commits an explicit failure terminal message', async () => {
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        executeConfirmedPlan: async ({ plan, onProgress }) => {
          onProgress?.('Connecting to the selected device…');
          onProgress?.('Waiting for the next safe action for Validation…');
          return {
            status: 'failed',
            path: 'device_backend',
            error: 'exploration_suggestion_invalid: invalid action',
            fallbackHistory: [],
            runDir: `/runs/${plan.runId}`,
          };
        },
      }),
    );
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    await session.selectDevice(PHYSICAL_DEVICE.udid);
    session.confirmPlan();

    const patches: TuiStatePatch[] = [];
    let activityId = '';
    for await (const patch of session.executeConfirmedPlan()) {
      patches.push(patch);
      if (patch.type === 'permission_request') {
        activityId = String(patch.payload.callId);
        await session.resolvePermission(activityId, 'allow');
      }
    }

    expect(patches).toContainEqual({
      type: 'activity_update',
      payload: {
        id: activityId,
        text: 'Connecting to the selected device…',
      },
    });
    expect(patches).toContainEqual({
      type: 'activity_update',
      payload: {
        id: activityId,
        text: 'Waiting for the next safe action for Validation…',
      },
    });
    const terminal = patches.find((patch) => patch.type === 'error');
    expect(String(terminal?.payload.message)).toContain('exploration_suggestion_invalid');
    expect(String(terminal?.payload.message)).toContain(
      `Run ${session.getConfirmedPlan()?.runId as string} was committed with the failure result.`,
    );
  });

  it('surfaces a no-progress termination instead of reporting generic completion', async () => {
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        executeConfirmedPlan: async ({ plan }) => ({
          status: 'completed',
          path: 'device_backend',
          fallbackHistory: [],
          runDir: `/runs/${plan.runId}`,
          result: {
            explorationTermination: {
              reason: 'no_progress',
              message: 'Execution stalled for Validation: repeated action.',
            },
            assertion: { status: 'inconclusive' },
          },
        }),
      }),
    );
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    await session.selectDevice(PHYSICAL_DEVICE.udid);
    session.confirmPlan();

    const patches: TuiStatePatch[] = [];
    for await (const patch of session.executeConfirmedPlan()) {
      patches.push(patch);
      if (patch.type === 'permission_request') {
        await session.resolvePermission(String(patch.payload.callId), 'allow');
      }
    }

    const terminal = patches.find((patch) => patch.type === 'message_add');
    expect(String(terminal?.payload.text)).toContain('Execution stalled for Validation');
    expect(String(terminal?.payload.text)).toContain('committed with status inconclusive');
  });

  it('binds one-shot execution permissions to the exact target and blocks managed WDA on denial', async () => {
    let executionCalls = 0;
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        preparesWda: () => true,
        executeConfirmedPlan: async () => {
          executionCalls += 1;
          return { status: 'completed', path: 'device_backend' };
        },
      }),
    );
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    await session.selectDevice(PHYSICAL_DEVICE.udid);
    session.confirmPlan();

    const iterator = session.executeConfirmedPlan()[Symbol.asyncIterator]();

    const buildPermission = await nextPatchOfType(iterator, 'permission_request');
    expect(buildPermission.payload).toMatchObject({
      action: 'execute_project_build',
      resource: 'com.example.Demo@physical-udid',
    });
    const callId = String(buildPermission.payload.callId);
    await session.resolvePermission(callId, 'allow');

    const replacePermission = await nextPatchOfType(iterator, 'permission_request');
    expect(replacePermission.payload).toMatchObject({
      callId,
      action: 'replace_device_app',
      resource: 'com.example.Demo@physical-udid',
    });
    await session.resolvePermission(callId, 'allow');

    const wdaPermission = await nextPatchOfType(iterator, 'permission_request');
    expect(wdaPermission.payload).toMatchObject({
      callId,
      action: 'prepare_wda',
      resource: 'com.example.Demo@physical-udid',
    });
    await session.resolvePermission(callId, 'deny');

    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
    }
    expect(executionCalls).toBe(0);
  });

  it('returns the real analyzer envelope supplied by the production seam', async () => {
    let analyzedRoot = '';
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        analyzeWorkspace: async (root) => {
          analyzedRoot = root;
          return FAKE_ANALYSIS as never;
        },
      }),
    );
    await enterModelTurn(session);

    const output = await sdkTool('analyzeProject').execute({}, { toolCallId: 'analyze-1' });
    expect(analyzedRoot).toBe('/workspace');
    expect(output).toEqual(FAKE_ANALYSIS);
  });

  it('reports target-scoped device state without exposing device identifiers', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    await collectMessagePatches(session, 'inspect devices');

    const output = (await sdkTool('getDeviceInfo').execute(
      {},
      { toolCallId: 'devices-1' },
    )) as Record<string, unknown>;
    expect(output.targetKind).toBe('physical');
    expect(output.ready).toBe(true);
    expect(output).not.toHaveProperty('connected');
    expect(output.selectedDevice).toBeNull();
    expect(output.devices).toEqual([
      {
        name: PHYSICAL_DEVICE.name,
        targetKind: 'physical',
        osVersion: PHYSICAL_DEVICE.osVersion,
        state: undefined,
        availability: 'ready',
      },
    ]);
    expect(JSON.stringify(output)).not.toContain(PHYSICAL_DEVICE.udid);
    expect(JSON.stringify(output)).not.toContain(SIMULATOR_DEVICE.udid);
  });

  it('settles an explicit refresh until a newly connected target becomes ready', async () => {
    const offline = { ...PHYSICAL_DEVICE, availability: 'discovered' as const };
    let discoveryCount = 0;
    const delays: number[] = [];
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        listDevices: async () => {
          discoveryCount += 1;
          return discoveryCount < 3
            ? [offline, SIMULATOR_DEVICE]
            : [PHYSICAL_DEVICE, SIMULATOR_DEVICE];
        },
        waitForDeviceRefresh: async (delayMs) => {
          delays.push(delayMs);
        },
      }),
    );
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());

    const patches = await session.refreshDevices();

    expect(delays).toEqual([250]);
    expect(discoveryCount).toBe(3);
    expect(patches.find((patch) => patch.type === 'devices_update')?.payload).toMatchObject({
      targetKind: 'physical',
      devices: [PHYSICAL_DEVICE, SIMULATOR_DEVICE],
    });
    expect(Array.isArray(await session.selectDevice(PHYSICAL_DEVICE.udid))).toBe(true);
  });

  it('continues from disconnected refresh through plan confirmation into execution', async () => {
    const offline = { ...PHYSICAL_DEVICE, availability: 'discovered' as const };
    let discoveryCount = 0;
    let modelTurns = 0;
    let executionCalls = 0;
    streamScenario = async function* () {
      modelTurns += 1;
      yield { type: 'finish' };
    };
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        listDevices: async () => {
          discoveryCount += 1;
          return discoveryCount === 1
            ? [offline, SIMULATOR_DEVICE]
            : [PHYSICAL_DEVICE, SIMULATOR_DEVICE];
        },
        executeConfirmedPlan: async () => {
          executionCalls += 1;
          return { status: 'completed', path: 'device_backend' };
        },
      }),
    );

    const planning = await collectMessagePatches(
      session,
      '用这台真机测试应用：启动后确认标题可见，点击按钮并采集截图。',
    );
    expect(modelTurns).toBe(0);
    expect(planning.some((patch) => patch.type === 'permission_request')).toBe(false);
    const deviceReview = session.confirmCandidates(confirmedFakeCandidates());
    expect(deviceReview.some((patch) => patch.type === 'device_selection_request')).toBe(true);

    const refreshed = await session.refreshDevices();
    expect(
      refreshed.some(
        (patch) =>
          patch.type === 'device_selection_request' &&
          (patch.payload.devices as DeviceInfo[]).some(
            (device) => device.udid === PHYSICAL_DEVICE.udid && device.availability === 'ready',
          ),
      ),
    ).toBe(true);
    const selected = await session.selectDevice(PHYSICAL_DEVICE.udid);
    expect(selected.some((patch) => patch.type === 'plan_update')).toBe(true);
    expect(
      session
        .confirmPlan()
        .some(
          (patch) =>
            patch.type === 'message_add' && String(patch.payload.text).includes('Starting'),
        ),
    ).toBe(true);

    const permissionActions: string[] = [];
    const executionPatches: TuiStatePatch[] = [];
    for await (const patch of session.executeConfirmedPlan()) {
      executionPatches.push(patch);
      if (patch.type === 'permission_request') {
        permissionActions.push(String(patch.payload.action));
        await session.resolvePermission(String(patch.payload.callId), 'allow');
      }
    }
    expect(permissionActions).toEqual(['execute_project_build', 'replace_device_app']);
    expect(permissionActions).not.toContain('generate_draft_test');
    expect(executionCalls).toBe(1);
    expect(executionPatches.some((patch) => patch.type === 'error')).toBe(false);
  });

  it('serializes competing refreshes so an older result cannot overwrite a newer result', async () => {
    let discoveryCount = 0;
    let releaseFirstRefresh!: () => void;
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    const offline = { ...PHYSICAL_DEVICE, availability: 'discovered' as const };
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        listDevices: async () => {
          discoveryCount += 1;
          if (discoveryCount === 2) {
            await firstRefreshGate;
            return [offline];
          }
          return [PHYSICAL_DEVICE];
        },
      }),
    );

    const older = session.refreshDevices();
    const newer = session.refreshDevices();
    await Promise.resolve();
    expect(discoveryCount).toBe(2);
    releaseFirstRefresh();
    await Promise.all([older, newer]);

    expect(discoveryCount).toBe(3);
    expect(session.getDevices()).toEqual([PHYSICAL_DEVICE]);
  });

  it('pauses the model tool loop at deterministic planning checkpoints', async () => {
    let modelTurns = 0;
    streamScenario = async function* (args) {
      modelTurns += 1;
      await args.tools.compileTestPlan?.execute({}, { toolCallId: 'compile-1' });
      yield { type: 'finish' };
    };
    const session = await createAgentSession('/workspace', dependencies());
    const patches = await collectMessagePatches(session, 'compile a plan');

    expect(modelTurns).toBe(0);
    expect(patches.some((patch) => patch.type === 'candidates_update')).toBe(true);
    expect(patches.some((patch) => patch.type === 'permission_request')).toBe(false);
    expect(capturedStreamArgs).toBeNull();
  });
});

describe('AgentSession streaming and permission bridge', () => {
  it('emits discovered devices before assistant deltas', async () => {
    streamScenario = async function* () {
      yield { type: 'text-delta', text: 'Observed result' };
    };
    const session = await createAgentSession('/workspace', dependencies());
    await collectPatches(session);
    const patches = await collectMessagePatches(session, 'inspect the current session');
    expect(patches.map((patch) => patch.type)).toEqual(['devices_update', 'message_update']);
    expect(patches.at(-1)?.payload.text).toBe('Observed result');
  });

  it('emits devices_update when getDeviceInfo refreshes discovery', async () => {
    let discoveryCount = 0;
    streamScenario = async function* (args) {
      await args.tools.getDeviceInfo?.execute({}, { toolCallId: 'refresh-devices' });
      yield { type: 'tool-result', toolCallId: 'refresh-devices' };
    };
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        listDevices: async () => {
          discoveryCount += 1;
          return discoveryCount === 1 ? [PHYSICAL_DEVICE] : [PHYSICAL_DEVICE, SIMULATOR_DEVICE];
        },
      }),
    );

    await collectPatches(session);
    const patches = await collectMessagePatches(session, 'inspect devices');
    const updates = patches.filter((patch) => patch.type === 'devices_update');
    expect(updates).toHaveLength(2);
    expect(updates[1]?.payload.devices).toEqual([PHYSICAL_DEVICE, SIMULATOR_DEVICE]);
  });

  it('uses transient activity patches and never emits raw tool results as messages', async () => {
    streamScenario = async function* (args) {
      await args.tools.getDeviceInfo?.execute({}, { toolCallId: 'safe-device-output' });
      yield {
        type: 'tool-result',
        toolCallId: 'safe-device-output',
        toolName: 'getDeviceInfo',
        output: { devices: [{ udid: 'must-not-render' }], profile: { secret: 'raw-json' } },
      };
    };
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    const patches = await collectMessagePatches(session, 'inspect devices');
    const renderedText = patches
      .filter((patch) => patch.type === 'message_add')
      .map((patch) => String(patch.payload.text ?? ''))
      .join('\n');

    expect(renderedText).not.toContain('must-not-render');
    expect(renderedText).not.toContain('raw-json');
    expect(patches).toContainEqual({
      type: 'activity_update',
      payload: { complete: true, id: 'safe-device-output' },
    });
  });

  it('delivers direct-execution permission requests while the tool call is blocked', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, '用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    await session.selectDevice(PHYSICAL_DEVICE.udid);
    session.confirmPlan();
    const iterator = session.executeConfirmedPlan()[Symbol.asyncIterator]();

    const preparing = await iterator.next();
    expect(preparing).toMatchObject({
      done: false,
      value: {
        type: 'activity_update',
        payload: { text: 'Preparing confirmed TestPlan execution…' },
      },
    });

    const permission = await nextPatchOfType(iterator, 'permission_request');
    const callId = String(permission.payload.callId);
    expect(permission.payload.action).toBe('execute_project_build');

    await session.resolvePermission(callId, 'deny');
    const remaining: TuiStatePatch[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }
    expect(remaining.some((patch) => patch.type === 'permission_resolved')).toBe(true);
    expect(remaining.some((patch) => patch.type === 'error')).toBe(true);
  });

  it('session disposal aborts direct execution and cancels a pending permission ask', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, '用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    await session.selectDevice(PHYSICAL_DEVICE.udid);
    session.confirmPlan();
    const iterator = session.executeConfirmedPlan()[Symbol.asyncIterator]();
    await nextPatchOfType(iterator, 'permission_request');

    session.dispose();

    const remaining: TuiStatePatch[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }
    expect(remaining.some((patch) => patch.type === 'permission_resolved')).toBe(true);
  });

  it('rejects concurrent turns instead of interleaving session state', async () => {
    let releaseStream: (() => void) | undefined;
    streamScenario = async function* () {
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
    };
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, 'first');
    const first = session.processMessage('second')[Symbol.asyncIterator]();
    await first.next();

    expect(() => session.processMessage('second')).toThrow('already in progress');
    releaseStream?.();
    await first.next();
  });
});

describe('AgentSession planning lifecycle', () => {
  it('preserves a confirmed plan across ordinary chat and replaces it only via /plan', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, '用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    await session.selectDevice(PHYSICAL_DEVICE.udid);
    const confirmPatches = session.confirmPlan();
    expect(confirmPatches.find((patch) => patch.type === 'message_add')?.payload.text).toContain(
      'Starting execution',
    );
    const runId = session.getConfirmedPlan()?.runId;

    const chatPatches = await collectMessagePatches(session, '解释一下刚才的计划');
    expect(chatPatches.some((patch) => patch.type === 'intent_update')).toBe(false);
    expect(chatPatches.some((patch) => patch.type === 'candidates_update')).toBe(false);
    expect(session.getConfirmedPlan()?.runId).toBe(runId);

    const newPlanPatches = await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    expect(newPlanPatches.some((patch) => patch.type === 'candidates_update')).toBe(true);
    expect(session.getConfirmedPlan()).toBeNull();
  });

  it('keeps cancellation terminal until an explicit /plan command starts a new cycle', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, '用本机 iPhone 跑登录 smoke');
    const reviewed = confirmedFakeCandidates();
    session.confirmCandidates(reviewed);
    const cancelPatches = session.cancelPlan();
    expect(cancelPatches.find((patch) => patch.type === 'message_add')?.payload.text).toContain(
      '/plan <test goal>',
    );

    await collectMessagePatches(session, '为什么取消了？');
    expect(() => session.confirmCandidates(reviewed)).toThrow('invalid_transition');

    const newPlanPatches = await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    expect(newPlanPatches.some((patch) => patch.type === 'candidates_update')).toBe(true);
  });

  it('requires a goal after the explicit /plan command', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectMessagePatches(session, '用本机 iPhone 跑登录 smoke');

    const patches = await collectMessagePatches(session, '/plan');
    expect(patches.find((patch) => patch.type === 'error')?.payload.message).toContain(
      'planning_goal_required',
    );
  });
});

describe('session lifecycle seams', () => {
  it('retains the newest transcript entries and disposes safely', async () => {
    const mod = await import('../src/agent-session.js');
    const session = await createAgentSession('/workspace', dependencies());
    expect(mod.retainSessionTranscript(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);
    expect(session.dispose()).toBeUndefined();
  });
});
