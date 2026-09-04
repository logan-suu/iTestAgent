import { describe, expect, it } from 'bun:test';
import type { TestPlan } from 'itestagent-contracts';
import { createDualExecutionDispatcher } from '../src/dual-execution-dispatcher.js';

function plan(path: 'xcuitest' | 'device_backend'): TestPlan {
  return {
    schemaVersion: 'itestagent.test-plan.v3',
    runId: 'run-1',
    projectProfileRef: '/profile.json',
    target: { type: 'current_workspace' },
    device: { kind: 'physical', physical: { selector: 'local_connected' } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: 'auto',
      fallback: path === 'xcuitest' ? 'abort' : 'device_backend',
      resolvedPath: path,
      selectionReason:
        path === 'xcuitest' ? 'evidence_backed_xcuitest' : 'confirmed_no_xcuitest_candidate',
      features: ['Login'],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      ...(path === 'xcuitest'
        ? { xcuitest: { scheme: 'Demo', testPlan: 'Smoke', targets: ['DemoUITests'] } }
        : {}),
    },
    artifacts: { collect: ['xcresult'], report: { outputs: ['summary_md'] } },
    performance: { baseline: 'skip', baselineDomain: 'physical', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: [] },
  };
}

function input(testPlan: TestPlan) {
  return {
    plan: testPlan,
    confirmed: true,
    workspace: '/workspace/Demo',
    destination: { targetKind: 'physical' as const, udid: 'DEVICE' },
    resultBundlePath: '/runs/run-1/artifacts/tests.xcresult',
  };
}

describe('createDualExecutionDispatcher', () => {
  it('runs only XCUITest readiness and runner for a confirmed XCUITest route', async () => {
    const calls: string[] = [];
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => {
        calls.push('xcuitest-readiness');
        return { ready: true };
      },
      runXcuitest: async (run) => {
        calls.push(
          `xcuitest:${run.scheme}:${run.testPlan}:${String(run.allowProvisioningUpdates)}`,
        );
        return { exitCode: 0, durationMs: 1, parsed: { cases: [] } as never };
      },
      runDeviceBackend: async () => {
        calls.push('device-backend');
        return {};
      },
    });

    const result = await dispatcher.dispatch(input(plan('xcuitest')));
    expect(result).toMatchObject({ status: 'completed', path: 'xcuitest' });
    expect(calls).toEqual(['xcuitest-readiness', 'xcuitest:Demo:Smoke:true']);
  });

  it('uses rerun case identifiers for -only-testing without changing configured targets', async () => {
    let captured: { only?: string[] } | undefined;
    const rerunPlan: TestPlan = {
      ...plan('xcuitest'),
      runId: 'run-child',
      rerun: {
        parentRunId: 'run-1',
        mode: 'failed_only',
        selectedCaseIds: ['DemoUITests/LoginTests/testInvalidPassword'],
      },
    };
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => ({ ready: true }),
      runXcuitest: async (run) => {
        captured = { only: run.only };
        return { exitCode: 0, durationMs: 1, parsed: { cases: [] } as never };
      },
      runDeviceBackend: async () => ({}),
    });

    await dispatcher.dispatch(input(rerunPlan));

    expect(captured?.only).toEqual(['DemoUITests/LoginTests/testInvalidPassword']);
    expect(rerunPlan.execution.xcuitest?.targets).toEqual(['DemoUITests']);
  });

  it('runs only the DeviceBackend handler and does not require XCUITest/WDA-shared readiness', async () => {
    const calls: string[] = [];
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => {
        calls.push('xcuitest-readiness');
        return { ready: true };
      },
      runXcuitest: async () => {
        calls.push('xcuitest');
        return { exitCode: 0, durationMs: 1, parsed: null };
      },
      runDeviceBackend: async () => {
        calls.push('device-backend');
        return { steps: [] };
      },
    });
    const result = await dispatcher.dispatch(input(plan('device_backend')));
    expect(result).toMatchObject({ status: 'completed', path: 'device_backend' });
    expect(calls).toEqual(['device-backend']);
  });

  it('keeps xcodebuild, test, and parse failures on XCUITest without fallback', async () => {
    let deviceCalls = 0;
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => ({ ready: true }),
      runXcuitest: async () => ({
        exitCode: 65,
        durationMs: 2,
        parsed: null,
        parseError: 'bundle missing',
      }),
      runDeviceBackend: async () => {
        deviceCalls += 1;
        return {};
      },
    });
    const result = await dispatcher.dispatch(input(plan('xcuitest')));
    expect(result).toMatchObject({
      status: 'failed',
      path: 'xcuitest',
      fallbackHistory: [],
    });
    expect(deviceCalls).toBe(0);
  });

  it('blocks changed execution facts without switching route', async () => {
    let runnerCalls = 0;
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => ({ ready: false, reason: 'scheme no longer enumerates' }),
      runXcuitest: async () => {
        runnerCalls += 1;
        return { exitCode: 0, durationMs: 1, parsed: null };
      },
      runDeviceBackend: async () => ({}),
    });
    const result = await dispatcher.dispatch(input(plan('xcuitest')));
    expect(result).toMatchObject({ status: 'blocked', path: 'xcuitest' });
    expect(runnerCalls).toBe(0);
  });

  it('normalizes rejected XCUITest revalidation without switching route', async () => {
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => {
        throw new Error('metadata revalidation failed');
      },
      runXcuitest: async () => {
        throw new Error('must not execute');
      },
      runDeviceBackend: async () => {
        throw new Error('must not fallback');
      },
    });
    const result = await dispatcher.dispatch({
      plan: plan('xcuitest'),
      confirmed: true,
      workspace: '/workspace/Demo',
      destination: { targetKind: 'physical', udid: 'PHONE' },
      resultBundlePath: '/runs/tests.xcresult',
    });
    expect(result).toEqual({
      status: 'blocked',
      path: 'xcuitest',
      error: 'metadata revalidation failed',
      fallbackHistory: [],
    });
  });

  it('rejects execution before confirmation', async () => {
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => ({ ready: true }),
      runXcuitest: async () => ({ exitCode: 0, durationMs: 1, parsed: null }),
      runDeviceBackend: async () => ({}),
    });
    const result = await dispatcher.dispatch({
      ...input(plan('device_backend')),
      confirmed: false,
    });
    expect(result).toMatchObject({
      status: 'blocked',
      error: expect.stringContaining('confirmation'),
    });
  });
});
