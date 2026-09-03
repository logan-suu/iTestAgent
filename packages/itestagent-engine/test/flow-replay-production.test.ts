import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  ArtifactRef,
  DeviceBackend,
  HealthCheckResult,
  RecordingHandle,
  UiTreeSnapshot,
} from 'itestagent-contracts';
import type { FlowV2 } from 'itestagent-flow';
import {
  type ProductionFlowReplayDependencies,
  loadProductionFlow,
  runProductionFlowReplay,
} from '../src/flow-replay-production.js';

const flowRoot = join(tmpdir(), `itestagent-engine-flow-load-${process.pid}`);

afterAll(() => rm(flowRoot, { recursive: true, force: true }));

function makeFlow(overrides: Partial<FlowV2> = {}): FlowV2 {
  return {
    schemaVersion: 'itestagent.flow.v2',
    flowId: 'production-replay',
    source: 'agent-recorded',
    status: 'confirmed',
    supportedTargetKinds: ['physical', 'simulator'],
    requiredCapabilities: ['appLifecycle'],
    lastValidatedTargets: [],
    steps: [{ action: 'launchApp', caseId: 'login', value: 'com.example.app' }],
    ...overrides,
  };
}

function makeDependencies(
  input: {
    healthy?: boolean;
    readiness?: boolean;
    closeError?: Error;
    onClose?: () => void;
    onLaunch?: () => void;
  } = {},
): ProductionFlowReplayDependencies {
  return {
    createBackend: (config) => {
      const backend: DeviceBackend & {
        probePhysicalReadiness(): Promise<{ ready: boolean; details?: string }>;
      } = {
        name: 'appium',
        capabilities: {
          supportedTargetKinds: [config.targetKind],
          features: ['launch'],
          supportsUiTree: true,
          supportsScreenshot: true,
          supportsVideo: false,
          supportsCrashLogs: false,
          supportsLocation: false,
          supportsPush: false,
        },
        async healthcheck(): Promise<HealthCheckResult> {
          return { healthy: input.healthy ?? true, details: 'test healthcheck' };
        },
        async listDevices() {
          return [];
        },
        async listApps() {
          return [];
        },
        async getUiTree(): Promise<UiTreeSnapshot> {
          return { raw: '<App/>', format: 'xml', capturedAt: new Date().toISOString() };
        },
        async probePhysicalReadiness() {
          return { ready: input.readiness ?? true, details: 'test readiness' };
        },
        async launchApp() {
          input.onLaunch?.();
          return { success: true };
        },
        async terminateApp() {
          return { success: true };
        },
        async screenshot(): Promise<ArtifactRef> {
          return { id: 'unused', type: 'screenshot', path: '', redactionStatus: 'raw-local-only' };
        },
        async tap() {
          return { success: true };
        },
        async swipe() {
          return { success: true };
        },
        async typeText() {
          return { success: true };
        },
        async pressButton() {
          return { success: true };
        },
        async openUrl() {
          return { success: true };
        },
        async startRecording(): Promise<RecordingHandle> {
          return { handleId: 'unused', startedAt: new Date().toISOString() };
        },
        async stopRecording(): Promise<ArtifactRef> {
          return { id: 'unused', type: 'video', path: '', redactionStatus: 'raw-local-only' };
        },
        async listCrashes() {
          return [];
        },
        async collectLogs(): Promise<ArtifactRef> {
          return { id: 'unused', type: 'log', path: '', redactionStatus: 'raw-local-only' };
        },
      };
      return {
        backend,
        async close() {
          input.onClose?.();
          if (input.closeError) throw input.closeError;
        },
      };
    },
  };
}

async function writeFlow(path: string, flow: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, 'utf-8');
}

describe('loadProductionFlow', () => {
  test('loads and validates a global Flow', async () => {
    const dataRoot = join(flowRoot, 'valid-data');
    await writeFlow(join(dataRoot, 'flows', 'valid.yaml'), makeFlow({ flowId: 'valid' }));

    const loaded = await loadProductionFlow('valid', { dataRoot });

    expect(loaded.source).toBe('global');
    expect(loaded.flow.flowId).toBe('valid');
  });

  test('reports aggregated schema issues for an invalid Flow', async () => {
    const dataRoot = join(flowRoot, 'invalid-data');
    await writeFlow(join(dataRoot, 'flows', 'invalid.yaml'), {
      ...makeFlow({ flowId: 'invalid' }),
      status: 'unknown',
      steps: 'not-an-array',
    });

    await expect(loadProductionFlow('invalid', { dataRoot })).rejects.toThrow(/status: .*; steps:/);
  });

  test('prefers a project Flow over a same-id global Flow', async () => {
    const dataRoot = join(flowRoot, 'precedence-data');
    const projectPath = join(flowRoot, 'project');
    await writeFlow(
      join(dataRoot, 'flows', 'precedence.yaml'),
      makeFlow({ flowId: 'precedence', notes: 'global' }),
    );
    await writeFlow(
      join(projectPath, '.itestagent', 'flows', 'precedence.yaml'),
      makeFlow({ flowId: 'precedence', notes: 'project' }),
    );

    const loaded = await loadProductionFlow('precedence', { dataRoot, projectPath });

    expect(loaded.source).toBe('project');
    expect(loaded.flow.notes).toBe('project');
  });
});

describe('runProductionFlowReplay', () => {
  test('runs a confirmed simulator Flow with explicit correlation and cleanup', async () => {
    let launched = 0;
    let closed = 0;
    const result = await runProductionFlowReplay(
      {
        flow: makeFlow(),
        targetKind: 'simulator',
        deviceId: 'sim-1',
        bundleId: 'com.example.app',
        appium: {},
        replay: { collectEvidence: false, runId: 'run-prod' },
      },
      makeDependencies({
        onLaunch: () => launched++,
        onClose: () => closed++,
      }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(launched).toBe(1);
    expect(closed).toBe(1);
    expect(result.replay.steps[0]).toMatchObject({
      stepId: 'run-prod-step-1',
      sequence: 1,
      targetKind: 'simulator',
      caseId: 'login',
    });
    expect(result.replay.steps[0]?.evidenceOutcomes.map((entry) => entry.status)).toEqual([
      'not_requested',
      'not_requested',
    ]);
  });

  test('blocks draft Flow without per-run confirmation before backend creation', async () => {
    let created = 0;
    const deps = makeDependencies();
    const result = await runProductionFlowReplay(
      {
        flow: makeFlow({ status: 'draft' }),
        targetKind: 'simulator',
        deviceId: 'sim-1',
        appium: {},
      },
      {
        createBackend: (config) => {
          created++;
          return deps.createBackend(config);
        },
      },
    );
    expect(result).toMatchObject({
      success: false,
      reasonCode: 'flow.draft_confirmation_required',
    });
    expect(created).toBe(0);
  });

  test('fails closed on unknown capabilities before creating an assembly', async () => {
    let created = 0;
    const deps = makeDependencies();
    const result = await runProductionFlowReplay(
      {
        flow: makeFlow({ requiredCapabilities: ['teleport'] }),
        targetKind: 'simulator',
        deviceId: 'sim-1',
        appium: {},
      },
      {
        createBackend(config) {
          created++;
          return deps.createBackend(config);
        },
      },
    );
    expect(result).toMatchObject({ success: false, reasonCode: 'blocked.capability_unsupported' });
    expect(created).toBe(0);
  });

  test('requires an active physical readiness probe before replay', async () => {
    let closed = 0;
    const result = await runProductionFlowReplay(
      {
        flow: makeFlow(),
        targetKind: 'physical',
        deviceId: 'phone-1',
        appium: { wdaStartupMode: 'external-url', webDriverAgentUrl: 'http://127.0.0.1:8100' },
      },
      makeDependencies({ readiness: false, onClose: () => closed++ }),
    );
    expect(result).toMatchObject({ success: false, reasonCode: 'infra.wda_not_ready' });
    expect(closed).toBe(1);
  });

  test('returns a structured cleanup failure without discarding completed replay facts', async () => {
    const result = await runProductionFlowReplay(
      {
        flow: makeFlow(),
        targetKind: 'simulator',
        deviceId: 'sim-1',
        appium: {},
        replay: { collectEvidence: false, runId: 'cleanup-failure' },
      },
      makeDependencies({ closeError: new Error('close exploded') }),
    );

    expect(result).toMatchObject({
      success: false,
      status: 'infra_failure',
      reasonCode: 'infra.backend_cleanup_failed',
      reason: 'close exploded',
      backend: 'appium',
      replay: { steps: [{ stepId: 'cleanup-failure-step-1' }] },
    });
  });

  test('retains the earlier failure when cleanup also fails', async () => {
    const result = await runProductionFlowReplay(
      {
        flow: makeFlow(),
        targetKind: 'simulator',
        deviceId: 'sim-1',
        appium: {},
      },
      makeDependencies({ healthy: false, closeError: new Error('close exploded') }),
    );

    expect(result).toMatchObject({
      success: false,
      reasonCode: 'infra.backend_cleanup_failed',
      primaryFailure: { reasonCode: 'infra.backend_unhealthy' },
    });
  });

  test('passes the run-scoped evidence directory into the backend assembly', async () => {
    let artifactDirectory: string | undefined;
    const deps = makeDependencies();
    const result = await runProductionFlowReplay(
      {
        flow: makeFlow(),
        targetKind: 'simulator',
        deviceId: 'sim-1',
        appium: {},
        replay: {
          collectEvidence: false,
          runId: 'scoped-artifacts',
          evidenceDirectory: '/tmp/itestagent-review/scoped-artifacts',
        },
      },
      {
        createBackend(config) {
          artifactDirectory = config.artifactDirectory;
          return deps.createBackend(config);
        },
      },
    );

    expect(result.success).toBe(true);
    expect(artifactDirectory).toBe('/tmp/itestagent-review/scoped-artifacts');
  });
});
