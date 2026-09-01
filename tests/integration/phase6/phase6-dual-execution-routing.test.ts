import { describe, expect, it } from 'bun:test';
import type { Intent, XcuitestExecutionCandidate } from 'itestagent-contracts';
import {
  compileTestPlan,
  createDualExecutionDispatcher,
  resolveExecutionRoute,
} from 'itestagent-engine';
import type { ProjectProfile } from 'itestagent-project-analyzer';

const profile: ProjectProfile = {
  schemaVersion: 'itestagent.project-profile.v1',
  projectHash: 'a'.repeat(64),
  app: { name: 'Demo', scheme: 'Demo' },
  targets: [
    { name: 'Demo', type: 'app' },
    { name: 'DemoUITests', type: 'test' },
  ],
  testAssets: { hasXCUITest: true, hasScheme: true, testTargets: ['DemoUITests'] },
  features: [
    {
      name: 'Login',
      evidence: ['LoginView.swift'],
      confidence: 0.8,
      confirmed: true,
      displayOrder: 0,
    },
  ],
  suggestedSmoke: ['launch', 'Login'],
};

const intent: Intent = {
  goal: 'login smoke test',
  targetKind: 'simulator',
  features: ['Login'],
  metricsRequested: false,
  scope: 'smoke',
  sourceText: 'Use Simulator for login smoke',
};

function runnable(overrides: Partial<XcuitestExecutionCandidate> = {}) {
  return {
    scheme: 'Demo',
    testPlan: 'Smoke',
    targets: ['DemoUITests'],
    targetKind: 'simulator' as const,
    isDefault: true,
    evidence: ['shared scheme TestAction metadata'],
    limitations: [],
    ...overrides,
  };
}

describe('Phase 6 dual execution routing', () => {
  it('flows evidence-backed resolution into canonical TestPlan v3', () => {
    const route = resolveExecutionRoute({
      preference: 'auto',
      targetKind: 'simulator',
      discoveryStatus: 'available',
      configurations: [runnable()],
    });
    expect(route.status).toBe('resolved');
    if (route.status !== 'resolved') throw new Error('route did not resolve');

    const plan = compileTestPlan(intent, profile, { confirmedOnly: true, executionRoute: route });
    expect(plan).toMatchObject({
      schemaVersion: 'itestagent.test-plan.v3',
      execution: {
        prefer: 'auto',
        resolvedPath: 'xcuitest',
        selectionReason: 'evidence_backed_xcuitest',
        xcuitest: { scheme: 'Demo', testPlan: 'Smoke', targets: ['DemoUITests'] },
      },
    });
  });

  it('uses DeviceBackend only when auto has authoritative candidate absence', () => {
    const route = resolveExecutionRoute({
      preference: 'auto',
      targetKind: 'simulator',
      discoveryStatus: 'none',
      configurations: [],
    });
    expect(route).toMatchObject({
      status: 'resolved',
      resolvedPath: 'device_backend',
      selectionReason: 'confirmed_no_xcuitest_candidate',
    });
  });

  it('keeps an XCUITest failure on its confirmed route end to end', async () => {
    const route = resolveExecutionRoute({
      preference: 'auto',
      targetKind: 'simulator',
      discoveryStatus: 'available',
      configurations: [runnable()],
    });
    if (route.status !== 'resolved') throw new Error('route did not resolve');
    const plan = compileTestPlan(intent, profile, { confirmedOnly: true, executionRoute: route });
    let deviceBackendCalls = 0;
    const dispatcher = createDualExecutionDispatcher({
      revalidateXcuitest: async () => ({ ready: true }),
      runXcuitest: async () => ({ exitCode: 65, durationMs: 5, parsed: null }),
      runDeviceBackend: async () => {
        deviceBackendCalls += 1;
        return {};
      },
    });
    const result = await dispatcher.dispatch({
      plan,
      confirmed: true,
      workspace: '/workspace/Demo',
      destination: { targetKind: 'simulator', simulatorId: 'SIM-1' },
      resultBundlePath: '/runs/run-1/tests.xcresult',
    });
    expect(result).toMatchObject({ status: 'failed', path: 'xcuitest', fallbackHistory: [] });
    expect(deviceBackendCalls).toBe(0);
  });
});
