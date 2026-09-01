import { describe, expect, it, mock } from 'bun:test';
import * as aiReal from 'ai';
import type { DeviceBackend } from 'itestagent-contracts';
import type { ProjectAnalysisResult } from 'itestagent-project-analyzer';

mock.module('ai', () => ({
  ...aiReal,
  streamText: () => ({ fullStream: (async function* () {})() }),
  stepCountIs: (count: number) => ({ count }),
  tool: (definition: Record<string, unknown>) => definition,
}));

const ANALYSIS: ProjectAnalysisResult = {
  profile: {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'b'.repeat(64),
    app: { name: 'Demo', workspace: '/workspace/Demo.xcworkspace', scheme: 'Demo' },
    targets: [{ name: 'Demo', type: 'app' }],
    testAssets: { hasXCUITest: false, hasScheme: true },
    features: [
      {
        name: 'Login',
        keywords: ['login', '登录'],
        evidence: ['LoginViewController.swift'],
        confidence: 0.82,
        confirmed: false,
        displayOrder: 0,
      },
      {
        name: 'Checkout',
        keywords: ['checkout', '下单'],
        evidence: ['CheckoutViewController.swift'],
        confidence: 0.71,
        confirmed: false,
        displayOrder: 1,
      },
    ],
    suggestedSmoke: ['launch', 'Login', 'Checkout'],
  },
  analysis: {
    analysisTier: 'tier1_static',
    enabledCapabilities: ['xcodebuild_discovery', 'static_source_candidates'],
    limitations: ['Candidates require confirmation.'],
    executionAssets: {
      statusByTargetKind: { physical: 'none', simulator: 'none' },
      configurations: [],
      evidence: ['Shared scheme metadata contains no XCUITest TestAction entries.'],
      limitations: [],
    },
  },
};

describe('Phase 6 intent → confirmed TestPlan production session', () => {
  it('keeps candidates and the plan non-executable until both confirmations', async () => {
    const { createAgentSession } = await import(
      '../../../packages/itestagent-tui/src/agent-session.js'
    );
    const { applyAgentPatch } = await import('../../../packages/itestagent-tui/src/entry.js');
    const { createInitialState, tuiShellReducer } = await import(
      '../../../packages/itestagent-tui/src/tui-shell.js'
    );

    const session = await createAgentSession('/workspace', {
      loadApiKey: async () => 'test-key',
      createModel: () =>
        ({ specificationVersion: 'v2', provider: 'test', modelId: 'planning' }) as never,
      analyzeWorkspace: async () => ANALYSIS,
      listDevices: async () => [],
      createDeviceBackend: () => ({ name: 'unused' }) as DeviceBackend,
    });

    let state = createInitialState('/workspace');
    for await (const patch of session.processMessage('用本机 iPhone 跑登录和下单 smoke')) {
      state = applyAgentPatch(state, patch);
    }

    expect(state.mode).toBe('candidate_review');
    expect(
      state.candidates.map(({ name, evidence, confidence }) => ({ name, evidence, confidence })),
    ).toEqual([
      { name: 'Login', evidence: ['LoginViewController.swift'], confidence: 0.82 },
      { name: 'Checkout', evidence: ['CheckoutViewController.swift'], confidence: 0.71 },
    ]);
    expect(session.getConfirmedPlan()).toBeNull();

    state = tuiShellReducer(state, { type: 'candidate_confirm_all' });
    for (const patch of session.confirmCandidates(state.candidates)) {
      state = applyAgentPatch(state, patch);
    }
    expect(state.mode).toBe('plan_review');
    expect(state.plan?.execution.features).toEqual(['Login', 'Checkout']);
    expect(session.getConfirmedPlan()).toBeNull();

    const originalRunId = state.plan?.runId;
    for (const patch of session.modifyPlan('只跑登录，不要下单')) {
      state = applyAgentPatch(state, patch);
    }
    expect(state.plan?.execution.features).toEqual(['Login']);
    expect(state.plan?.runId).toBe(originalRunId);
    expect(session.getConfirmedPlan()).toBeNull();

    for (const patch of session.confirmPlan()) state = applyAgentPatch(state, patch);
    expect(state.mode).toBe('chat');
    expect(state.planConfirmed).toBe(true);
    expect(session.getConfirmedPlan()?.execution.features).toEqual(['Login']);

    for await (const patch of session.processMessage('解释一下刚才确认的计划')) {
      state = applyAgentPatch(state, patch);
    }
    expect(state.planConfirmed).toBe(true);
    expect(state.plan?.runId).toBe(originalRunId);
    expect(session.getConfirmedPlan()?.runId).toBe(originalRunId);

    for await (const patch of session.processMessage('/plan 用本机 iPhone 跑登录 smoke')) {
      state = applyAgentPatch(state, patch);
    }
    expect(state.mode).toBe('candidate_review');
    expect(state.plan).toBeNull();
    expect(state.planConfirmed).toBe(false);
    expect(session.getConfirmedPlan()).toBeNull();
  });

  it('cancels a draft without exposing a confirmed plan', async () => {
    const { createAgentSession } = await import(
      '../../../packages/itestagent-tui/src/agent-session.js'
    );
    const session = await createAgentSession('/workspace', {
      loadApiKey: async () => 'test-key',
      createModel: () =>
        ({ specificationVersion: 'v2', provider: 'test', modelId: 'planning' }) as never,
      analyzeWorkspace: async () => ANALYSIS,
      listDevices: async () => [],
    });
    for await (const _patch of session.processMessage('用本机 iPhone 跑登录 smoke')) {
      // Drain the planning turn.
    }
    const candidates = ANALYSIS.profile.features.map((candidate) => ({
      ...candidate,
      confirmed: candidate.name === 'Login',
    }));
    session.confirmCandidates(candidates);
    session.cancelPlan();
    expect(session.getConfirmedPlan()).toBeNull();
  });
});
