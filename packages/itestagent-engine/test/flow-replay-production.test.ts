import { describe, expect, test } from 'bun:test';
import type { DeviceBackend, HealthCheckResult, UiTreeSnapshot } from 'itestagent-contracts';
import type { FlowV2 } from 'itestagent-flow';
import {
  type ProductionFlowReplayDependencies,
  runProductionFlowReplay,
} from '../src/flow-replay-production.js';

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
    onClose?: () => void;
    onLaunch?: () => void;
  } = {},
): ProductionFlowReplayDependencies {
  return {
    createBackend: (config) => {
      const backend = {
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
      } as unknown as DeviceBackend;
      return {
        backend,
        async close() {
          input.onClose?.();
        },
      };
    },
  };
}

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

  test('fails closed on unknown capabilities and still cleans up the assembly', async () => {
    let closed = 0;
    const result = await runProductionFlowReplay(
      {
        flow: makeFlow({ requiredCapabilities: ['teleport'] }),
        targetKind: 'simulator',
        deviceId: 'sim-1',
        appium: {},
      },
      makeDependencies({ onClose: () => closed++ }),
    );
    expect(result).toMatchObject({ success: false, reasonCode: 'blocked.capability_unsupported' });
    expect(closed).toBe(1);
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
});
