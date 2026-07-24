/**
 * Phase 3 integration — ContextBuilder: Profile + Intent + TestPlan + RunState → LLM context.
 *
 * Cross-package chain: itestagent-project-analyzer (ProjectProfile) + itestagent-contracts
 * (Intent, TestPlan, RunStep, AgentTurnInput) + itestagent-engine (ContextBuilder).
 *
 * Task 3.4 verification: ContextBuilder correctly assembles sanitized context from
 * Phase 2 (Profile/Intent/TestPlan) and Phase 3 (RunState/previousSteps) objects.
 */
import { describe, expect, it } from 'bun:test';
import { AgentTurnInputSchema, IntentSchema } from 'itestagent-contracts';
import { ContextBuilder } from 'itestagent-engine';
import type { ProjectProfile } from 'itestagent-project-analyzer';

function fixtureProfile(): ProjectProfile {
  return {
    schemaVersion: 'itestagent.project-profile.v1',
    projectHash: 'a'.repeat(64),
    app: {
      name: 'TestApp',
      bundleId: 'com.test.app',
      workspace: 'TestApp.xcworkspace',
      scheme: 'TestApp',
    },
    targets: [
      { name: 'TestApp', type: 'app', bundleId: 'com.test.app' },
      { name: 'TestAppUITests', type: 'test' },
    ],
    testAssets: { hasXCUITest: true, hasScheme: true, testTargets: ['TestAppUITests'] },
    features: [
      {
        name: 'Login',
        entry: 'LoginViewController',
        keywords: ['login', 'auth', 'signin'],
        testability: 'device_backend',
        evidence: ['LoginViewController.swift'],
        confidence: 0.9,
        confirmed: false,
        displayOrder: 0,
        expectedOutcomes: ['login screen should appear', 'login success navigates to home'],
      },
    ],
    suggestedSmoke: ['Login'],
  };
}

describe('Phase 3 ContextBuilder integration', () => {
  const builder = new ContextBuilder();

  it('buildSystemPrompt assembles Profile + Intent + RunState', () => {
    const profile = fixtureProfile();
    const intent = IntentSchema.parse({
      goal: 'test login flow',
      targetHint: 'simulator',
      features: ['Login'],
      metricsRequested: false,
      scope: 'smoke',
      sourceText: 'test login flow',
    });

    const systemPrompt = builder.buildSystemPrompt({
      projectProfile: profile,
      intent,
      runState: 'executing',
    } as any);

    expect(systemPrompt).toContain('TestApp');
    expect(systemPrompt).toContain('com.test.app');
    expect(systemPrompt).toContain('Login');
  });

  it('buildSystemPrompt works with minimal inputs', () => {
    const profile = fixtureProfile();
    const systemPrompt = builder.buildSystemPrompt({
      projectProfile: profile,
      runState: 'created',
    } as any);

    expect(systemPrompt).toContain('TestApp');
    expect(systemPrompt).toContain('created');
  });

  it('buildTurn produces valid AgentTurnInput', () => {
    const profile = fixtureProfile();
    const turn = builder.buildTurn({
      projectProfile: profile,
      runState: 'executing',
      previousSteps: [],
    } as any);

    expect(turn.messages).toBeDefined();
    expect(Array.isArray(turn.messages)).toBe(true);

    const parsed = AgentTurnInputSchema.safeParse(turn);
    expect(parsed.success).toBe(true);
  });

  it('buildTurn includes previous step details', () => {
    const profile = fixtureProfile();
    const previousSteps = [
      {
        stepId: 'step-1',
        backend: 'mock',
        action: 'tap',
        target: 'Login',
        input: {},
        result: {},
        startedAt: new Date().toISOString(),
        durationMs: 150,
        artifacts: [],
      },
    ];

    const turn = builder.buildTurn({
      projectProfile: profile,
      runState: 'executing',
      previousSteps,
    } as any);

    const sysMsg = turn.messages[0] as { content: string };
    expect(sysMsg.content).toContain('Login');
  });

  it('buildSystemPrompt with previousSteps includes step context', () => {
    const profile = fixtureProfile();
    const previousSteps = [
      {
        stepId: 'step-1',
        backend: 'mock',
        action: 'launch_app',
        target: 'com.test.app',
        input: {},
        result: {},
        startedAt: new Date().toISOString(),
        durationMs: 1200,
        artifacts: [],
      },
      {
        stepId: 'step-2',
        backend: 'mock',
        action: 'tap',
        target: 'Login',
        input: {},
        result: {},
        startedAt: new Date().toISOString(),
        durationMs: 200,
        artifacts: [],
      },
    ];

    const systemPrompt = builder.buildSystemPrompt({
      projectProfile: profile,
      runState: 'executing',
      previousSteps,
    } as any);

    expect(systemPrompt).toContain('step-1');
    expect(systemPrompt).toContain('step-2');
    expect(systemPrompt).toContain('launch_app');
  });

  it('sanitizeText redacts API keys (R6)', () => {
    const input = 'Authorization: sk-proj-abcdef1234567890_xyz_secret';
    const sanitized = builder.sanitizeText(input);
    expect(sanitized).not.toContain('sk-proj');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('sanitizeText redacts JWT tokens', () => {
    const input = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
    const sanitized = builder.sanitizeText(input);
    expect(sanitized).not.toContain('eyJ');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('sanitizeText redacts password/token patterns', () => {
    const cases = [
      'password="super_secret_123"',
      'token=abcdefghijklmnopqrst',
      'secret: my_top_secret_value',
      'api_key=sk-live-abcdefg',
    ];

    for (const input of cases) {
      const sanitized = builder.sanitizeText(input);
      expect(sanitized).not.toBe(input);
      expect(sanitized).toContain('[REDACTED]');
    }
  });

  it('sanitizeText leaves safe text unchanged', () => {
    const safe = 'This is a normal message about the login feature.';
    expect(builder.sanitizeText(safe)).toBe(safe);
  });

  it('buildTurn validates AgentTurnInput with system + messages', () => {
    const profile = fixtureProfile();
    const turn = builder.buildTurn({
      projectProfile: profile,
      runState: 'executing',
    } as any);

    const parsed = AgentTurnInputSchema.safeParse(turn);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.messages).toBeDefined();
    }
  });
});
