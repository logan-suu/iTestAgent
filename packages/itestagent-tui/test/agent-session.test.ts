import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as aiReal from 'ai';
import type { DeviceBackend, DeviceInfo } from 'itestagent-contracts';
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
  profile: { schemaVersion: 'itestagent.project-profile.v1', project: { root: '/workspace' } },
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

async function collectPatches(session: TuiAgentSession): Promise<TuiStatePatch[]> {
  const patches: TuiStatePatch[] = [];
  for await (const patch of session.processMessage('inspect the workspace')) patches.push(patch);
  return patches;
}

function sdkTool(name: string): SdkTool {
  const tool = capturedStreamArgs?.tools[name];
  if (!tool) throw new Error(`SDK tool was not registered: ${name}`);
  return tool;
}

beforeEach(async () => {
  capturedStreamArgs = null;
  streamScenario = async function* () {};
  ({ createAgentSession } = await import('../src/agent-session.js'));
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
});

describe('AgentSession tools', () => {
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

  it('reports unwired downstream capabilities instead of fabricating success', async () => {
    const session = await createAgentSession('/workspace', dependencies());
    await collectPatches(session);

    const pending = sdkTool('compileTestPlan').execute({}, { toolCallId: 'compile-1' });
    await Promise.resolve();
    session.resolvePermission('compile-1', 'allow');
    const error = await pending.then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('capability_not_wired');
    expect((error as Error).message).toContain('task 6.3');
  });
});

describe('AgentSession streaming and permission bridge', () => {
  it('emits discovered devices before assistant deltas', async () => {
    streamScenario = async function* () {
      yield { type: 'text-delta', text: 'Observed result' };
    };
    const session = await createAgentSession('/workspace', dependencies());

    const patches = await collectPatches(session);
    expect(patches.map((patch) => patch.type)).toEqual(['devices_update', 'message_update']);
    expect(patches[1]?.payload.text).toBe('Observed result');
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
    const permission = await iterator.next();
    expect(permission.value?.type).toBe('permission_request');
    expect(permission.value?.payload.callId).toBe('permission-1');

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

describe('session lifecycle seams', () => {
  it('retains the newest transcript entries and disposes safely', async () => {
    const mod = await import('../src/agent-session.js');
    const session = await createAgentSession('/workspace', dependencies());
    expect(mod.retainSessionTranscript(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);
    expect(session.dispose()).toBeUndefined();
  });
});
