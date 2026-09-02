/**
 * simulator-fixture-flow.test.ts — B08 end-to-end fixture (promotion guide
 * §11.3 "Flow replay/redaction"; §6.1 "Flow replay … 迁移时保持 generic
 * fixture，不带产品 locator").
 *
 * A generic simulator-target FlowV2 fixture is replayed against a scripted
 * fake DeviceBackend. Locks the full pipeline through the B08 module split:
 * target compatibility gate → step dispatch → summary accounting, plus the
 * cross-target blocking contract (ADR-011).
 */
import { describe, expect, it } from 'bun:test';
import type { DeviceBackend } from 'itestagent-contracts';
import { checkTargetCompatibility, replayFlow } from '../src/replay.js';
import { type FlowV2, parseFlowV2 } from '../src/schema.js';

/** Generic simulator fixture flow — no product identifiers, placeholder bundle only. */
function makeSimulatorFixtureFlow(): FlowV2 {
  return parseFlowV2({
    schemaVersion: 'itestagent.flow.v2',
    flowId: 'flow_sim_fixture_b08',
    source: 'user-authored',
    status: 'confirmed',
    supportedTargetKinds: ['simulator'],
    requiredCapabilities: ['appLifecycle'],
    lastValidatedTargets: [],
    steps: [
      { action: 'launchApp', value: 'com.example.fixture.app' },
      { action: 'comment', comment: 'fixture scroll placeholder' },
      { action: 'terminateApp', value: 'com.example.fixture.app' },
    ],
  });
}

function makeScriptedBackend() {
  const calls: string[] = [];
  const backend = {
    name: 'b08-scripted-fixture',
    async launchApp() {
      calls.push('launch');
      return { success: true };
    },
    async terminateApp() {
      calls.push('terminate');
      return { success: true };
    },
    async screenshot(): Promise<never> {
      throw new Error('no screenshot in fixture');
    },
    async getUiTree(): Promise<never> {
      throw new Error('no uiTree in fixture');
    },
  } as unknown as DeviceBackend;
  return { backend, calls };
}

describe('simulator fixture flow (B08)', () => {
  it('replays a lifecycle-only flow green despite missing evidence captures', async () => {
    const flow = makeSimulatorFixtureFlow();
    const { backend, calls } = makeScriptedBackend();

    const result = await replayFlow(flow, backend, {
      targetKind: 'simulator',
      deviceId: 'sim-fixture-b08',
      collectEvidence: true,
    });

    // Evidence capture failures are non-fatal by design (§6.1): the lifecycle
    // steps still pass even though the scripted backend cannot screenshot.
    expect(result.overallStatus).toBe('passed');
    expect(result.summary.total).toBe(3);
    expect(result.summary.passed).toBe(3);
    expect(calls).toEqual(['launch', 'terminate']);
    expect(result.targetKind).toBe('simulator');
    expect(result.flowId).toBe('flow_sim_fixture_b08');
  });

  it('blocks cross-target replay checks for a physical request (ADR-011)', () => {
    const flow = makeSimulatorFixtureFlow();
    const physical = checkTargetCompatibility(flow, 'physical');
    expect(physical.ok).toBe(false);
    expect(physical.reason).toContain('blocked per ADR-011');

    const simulator = checkTargetCompatibility(flow, 'simulator');
    expect(simulator.ok).toBe(true);
  });

  it('aborts cleanly mid-flow when the signal fires between steps', async () => {
    const flow = makeSimulatorFixtureFlow();
    const controller = new AbortController();
    // Abort after the first step's microtasks settle.
    queueMicrotask(() => controller.abort());

    const { backend } = makeScriptedBackend();
    const result = await replayFlow(flow, backend, {
      targetKind: 'simulator',
      deviceId: 'sim-fixture-b08-abort',
      signal: controller.signal,
    });

    expect(result.overallStatus).toBe('blocked');
    // Remaining steps are accounted as skipped rather than dropped (R5).
    expect(result.summary.skipped + result.summary.passed).toBe(3);
  });
});
