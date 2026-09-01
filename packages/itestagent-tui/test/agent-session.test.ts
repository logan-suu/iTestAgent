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
};

const SIMULATOR_DEVICE: DeviceInfo = {
  udid: 'simulator-udid',
  name: 'iPhone 16 Pro',
  osVersion: '18.0',
  platform: 'ios',
  targetKind: 'simulator',
  state: 'booted',
};

const FAKE_ANALYSIS = {
  profile: {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'a'.repeat(64),
    app: { name: 'Demo', workspace: '/workspace/Demo.xcworkspace', scheme: 'Demo' },
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

  it('exposes discovered targets and binds the first physical device only', async () => {
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
    expect(bound).toEqual([PHYSICAL_DEVICE]);
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
});

describe('AgentSession tools', () => {
  it('dispatches the exact confirmed v3 plan instead of returning the task 6.5 placeholder', async () => {
    const dispatched: Array<{ runId: string; device: string }> = [];
    const session = await createAgentSession(
      '/workspace',
      dependencies({
        executeConfirmedPlan: async ({ plan, device }) => {
          dispatched.push({ runId: plan.runId, device: device.udid });
          return { status: 'completed', path: plan.execution.resolvedPath };
        },
      }),
    );
    await collectMessagePatches(session, '/plan 用本机 iPhone 跑登录 smoke');
    session.confirmCandidates(confirmedFakeCandidates());
    const confirmed = session.confirmPlan();
    expect(confirmed.some((patch) => patch.payload.confirmed === true)).toBe(true);

    const outputPromise = sdkTool('executeTestPlan').execute({}, { toolCallId: 'execute-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.resolvePermission('execute-1', 'allow');
    const output = await outputPromise;
    expect(output).toEqual({ status: 'completed', path: 'device_backend' });
    expect(dispatched).toEqual([
      { runId: session.getConfirmedPlan()?.runId as string, device: PHYSICAL_DEVICE.udid },
    ]);
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
    await collectPatches(session);

    const output = await sdkTool('analyzeProject').execute({}, { toolCallId: 'analyze-1' });
    expect(analyzedRoot).toBe('/workspace');
    expect(output).toEqual(FAKE_ANALYSIS);
  });

  it('reports observed device state without a canned connected result', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectPatches(session);

    const output = (await sdkTool('getDeviceInfo').execute(
      {},
      { toolCallId: 'devices-1' },
    )) as Record<string, unknown>;
    expect(output.connected).toBe(true);
    expect(output.selectedDevice).toEqual(PHYSICAL_DEVICE);
    expect(output.devices).toEqual([PHYSICAL_DEVICE, SIMULATOR_DEVICE]);
  });

  it('blocks TestPlan compilation until candidate confirmation', async () => {
    streamScenario = async function* (args) {
      try {
        await args.tools.compileTestPlan?.execute({}, { toolCallId: 'compile-1' });
      } catch (error: unknown) {
        yield { type: 'tool-error', toolCallId: 'compile-1', error };
      }
    };
    const session = await createAgentSession('/workspace', dependencies());
    const iterator = session.processMessage('compile a plan')[Symbol.asyncIterator]();

    expect((await iterator.next()).value?.type).toBe('devices_update');
    const permission = await nextPatchOfType(iterator, 'permission_request');
    expect(permission).toMatchObject({
      type: 'permission_request',
      payload: { callId: 'compile-1' },
    });
    session.resolvePermission('compile-1', 'allow');

    const remaining: TuiStatePatch[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }
    const errorPatch = remaining.find((patch) => patch.type === 'error');
    expect(errorPatch?.payload.message).toContain('candidate_confirmation_required');
  });
});

describe('AgentSession streaming and permission bridge', () => {
  it('emits discovered devices before assistant deltas', async () => {
    streamScenario = async function* () {
      yield { type: 'text-delta', text: 'Observed result' };
    };
    const session = await createAgentSession('/workspace', dependencies());

    const patches = await collectPatches(session);
    expect(patches.map((patch) => patch.type)).toEqual([
      'devices_update',
      'intent_update',
      'candidates_update',
      'mode_change',
      'message_update',
    ]);
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

    const patches = await collectPatches(session);
    const updates = patches.filter((patch) => patch.type === 'devices_update');
    expect(updates).toHaveLength(2);
    expect(updates[1]?.payload.devices).toEqual([PHYSICAL_DEVICE, SIMULATOR_DEVICE]);
  });

  it('delivers permission requests while the tool call is blocked', async () => {
    streamScenario = async function* (args) {
      try {
        await args.tools.compileTestPlan?.execute({}, { toolCallId: 'permission-1' });
      } catch (error: unknown) {
        yield { type: 'tool-error', toolCallId: 'permission-1', error };
      }
    };
    const session = await createAgentSession('/workspace', dependencies());
    const iterator = session.processMessage('compile a plan')[Symbol.asyncIterator]();

    expect((await iterator.next()).value?.type).toBe('devices_update');
    const permission = await nextPatchOfType(iterator, 'permission_request');
    expect(permission.payload.callId).toBe('permission-1');

    session.resolvePermission('permission-1', 'deny');
    const remaining: TuiStatePatch[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }
    expect(remaining.some((patch) => patch.type === 'permission_resolved')).toBe(true);
    expect(remaining.some((patch) => patch.type === 'error')).toBe(true);
  });

  it('rejects concurrent turns instead of interleaving session state', async () => {
    let releaseStream: (() => void) | undefined;
    streamScenario = async function* () {
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
    };
    const session = await createAgentSession('/workspace', dependencies());
    const first = session.processMessage('first')[Symbol.asyncIterator]();
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
    const confirmPatches = session.confirmPlan();
    expect(confirmPatches.find((patch) => patch.type === 'message_add')?.payload.text).toContain(
      '/plan <test goal>',
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
