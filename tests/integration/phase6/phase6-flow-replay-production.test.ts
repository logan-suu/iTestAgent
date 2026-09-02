import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ActionResult,
  ArtifactRef,
  BackendCapabilities,
  DeviceBackend,
  HealthCheckResult,
  UiTreeSnapshot,
} from 'itestagent-contracts';
import { type ProductionFlowReplayDependencies, runProductionFlowReplay } from 'itestagent-engine';
import type { FlowV2 } from 'itestagent-flow';

const evidenceRoot = join(tmpdir(), `itestagent-t6-7-${Date.now()}`);

afterAll(async () => {
  await rm(evidenceRoot, { recursive: true, force: true });
});

function flow(overrides: Partial<FlowV2> = {}): FlowV2 {
  return {
    schemaVersion: 'itestagent.flow.v2',
    flowId: 'phase6-production-replay',
    source: 'agent-recorded',
    status: 'confirmed',
    supportedTargetKinds: ['physical', 'simulator'],
    requiredCapabilities: ['appLifecycle'],
    lastValidatedTargets: [{ kind: 'simulator', udid: 'historical-device' }],
    steps: [{ action: 'launchApp', caseId: 'login', value: 'com.example.app' }],
    ...overrides,
  };
}

function productionDependencies(input: {
  health?: boolean;
  readiness?: boolean;
  calls: string[];
}): ProductionFlowReplayDependencies {
  return {
    createBackend: (config) => {
      const capabilities: BackendCapabilities = {
        supportedTargetKinds: [config.targetKind],
        features: ['launch', 'uitree', 'screenshot'],
        supportsUiTree: true,
        supportsScreenshot: true,
        supportsVideo: false,
        supportsCrashLogs: false,
        supportsLocation: false,
        supportsPush: false,
      };
      const backend = {
        name: 'appium',
        capabilities,
        async healthcheck(): Promise<HealthCheckResult> {
          input.calls.push('healthcheck');
          return { healthy: input.health ?? true, details: 'phase6 fixture' };
        },
        async probePhysicalReadiness() {
          input.calls.push('physical-readiness');
          return { ready: input.readiness ?? true, details: 'phase6 fixture' };
        },
        async getUiTree(): Promise<UiTreeSnapshot> {
          input.calls.push('ui-tree');
          return {
            raw: '<App><Button name="Login"/></App>',
            format: 'xml',
            capturedAt: new Date().toISOString(),
          };
        },
        async screenshot(): Promise<ArtifactRef> {
          input.calls.push('screenshot');
          return {
            id: 'phase6-screenshot',
            type: 'screenshot',
            path: import.meta.path,
            redactionStatus: 'safe',
          };
        },
        async launchApp(): Promise<ActionResult> {
          input.calls.push('launch');
          return { success: true };
        },
      } as unknown as DeviceBackend & {
        probePhysicalReadiness(signal?: AbortSignal): Promise<{ ready: boolean; details?: string }>;
      };
      return {
        backend,
        async close() {
          input.calls.push('close');
        },
      };
    },
  };
}

describe('T6.7 production Flow replay', () => {
  test('replays on an explicit simulator with correlated real evidence', async () => {
    const calls: string[] = [];
    const inputFlow = flow();
    const before = structuredClone(inputFlow);
    const result = await runProductionFlowReplay(
      {
        flow: inputFlow,
        targetKind: 'simulator',
        deviceId: 'simulator-1',
        appium: {},
        replay: {
          runId: 'phase6-sim',
          evidenceDirectory: join(evidenceRoot, 'simulator'),
          collectEvidence: true,
        },
      },
      productionDependencies({ calls }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(calls).toEqual(['healthcheck', 'ui-tree', 'launch', 'screenshot', 'ui-tree', 'close']);
    expect(result.replay.targetKind).toBe('simulator');
    expect(result.replay.steps[0]).toMatchObject({
      stepId: 'phase6-sim-step-1',
      sequence: 1,
      targetKind: 'simulator',
      caseId: 'login',
    });
    expect(result.replay.steps[0]?.evidenceOutcomes.map((entry) => entry.status)).toEqual([
      'success',
      'success',
    ]);
    for (const artifact of result.replay.steps[0]?.evidence ?? []) {
      expect(artifact.path).not.toBe('');
      expect(existsSync(artifact.path)).toBe(true);
      expect(artifact.redactionStatus).toBe('raw-local-only');
      expect(artifact.relatedStep).toBe('phase6-sim-step-1');
      expect(artifact.relatedCase).toBe('login');
    }
    expect(inputFlow).toEqual(before);
  });

  test('uses the physical active-readiness route and always cleans up', async () => {
    const calls: string[] = [];
    const result = await runProductionFlowReplay(
      {
        flow: flow(),
        targetKind: 'physical',
        deviceId: 'phone-1',
        appium: { wdaStartupMode: 'external-url', webDriverAgentUrl: 'http://127.0.0.1:8100' },
        replay: { collectEvidence: false },
      },
      productionDependencies({ calls }),
    );
    expect(result.success).toBe(true);
    expect(calls).toEqual(['healthcheck', 'physical-readiness', 'launch', 'close']);
  });

  test('fails closed before execution for unknown capability and deprecated status', async () => {
    const capabilityCalls: string[] = [];
    const capabilityResult = await runProductionFlowReplay(
      {
        flow: flow({ requiredCapabilities: ['teleport'] }),
        targetKind: 'simulator',
        deviceId: 'simulator-1',
        appium: {},
      },
      productionDependencies({ calls: capabilityCalls }),
    );
    expect(capabilityResult).toMatchObject({
      success: false,
      reasonCode: 'blocked.capability_unsupported',
    });
    expect(capabilityCalls).toEqual(['close']);

    const deprecatedCalls: string[] = [];
    const deprecatedResult = await runProductionFlowReplay(
      {
        flow: flow({ status: 'deprecated' }),
        targetKind: 'simulator',
        deviceId: 'simulator-1',
        appium: {},
      },
      productionDependencies({ calls: deprecatedCalls }),
    );
    expect(deprecatedResult).toMatchObject({ success: false, reasonCode: 'flow.deprecated' });
    expect(deprecatedCalls).toEqual([]);
  });

  test('blocks cross-target replay without constructing a backend', async () => {
    const calls: string[] = [];
    const result = await runProductionFlowReplay(
      {
        flow: flow({ supportedTargetKinds: ['physical'] }),
        targetKind: 'simulator',
        deviceId: 'simulator-1',
        appium: {},
      },
      productionDependencies({ calls }),
    );
    expect(result).toMatchObject({ success: false, reasonCode: 'target.incompatible' });
    expect(calls).toEqual([]);
  });
});
