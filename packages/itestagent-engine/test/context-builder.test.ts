import { describe, expect, test } from 'bun:test';
import type { Intent, RunState, RunStep, TestPlan } from 'itestagent-contracts';
import type { ProjectProfile } from 'itestagent-project-analyzer';
import { ContextBuilder } from '../src/context-builder.js';
import type { BuildContextInput } from '../src/context-builder.js';

// ─── Fixtures ─────────────────────────────────────────────────

const MOCK_PROFILE: ProjectProfile = {
  schemaVersion: 'itestagent.project-profile.v1',
  projectHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  app: {
    name: 'TestApp',
    bundleId: 'com.example.TestApp',
    scheme: 'TestApp',
    workspace: 'TestApp.xcworkspace',
  },
  targets: [
    { name: 'TestApp', type: 'app' },
    { name: 'TestAppTests', type: 'test' },
  ],
  testAssets: {
    hasXCUITest: true,
    hasScheme: true,
    testTargets: ['TestAppTests'],
  },
  features: [
    {
      name: 'Login Flow',
      entry: 'LoginViewController',
      keywords: ['login', 'auth'],
      testability: 'device_backend',
      requiresAccount: true,
      evidence: ['Found LoginViewController.swift'],
      confidence: 0.9,
      confirmed: true,
      displayOrder: 0,
    },
    {
      name: 'Settings Flow',
      entry: 'SettingsViewController',
      keywords: ['settings'],
      testability: 'device_backend',
      requiresAccount: false,
      evidence: ['Found SettingsViewController.swift'],
      confidence: 0.7,
      confirmed: false,
      displayOrder: 1,
    },
  ],
  suggestedSmoke: ['Login Flow'],
};

const MOCK_INTENT: Intent = {
  goal: 'Test the login flow on iPhone',
  targetKind: 'physical' as const,
  scope: 'smoke',
  features: ['Login Flow'],
  metricsRequested: false,
  sourceText: 'test login flow on iPhone',
};

const MOCK_TEST_PLAN: TestPlan = {
  schemaVersion: 'itestagent.test-plan.v1' as const,
  runId: 'run-001',
  projectProfileRef: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  target: { type: 'current_workspace' },
  device: {
    kind: 'physical' as const,
  },
  appSource: { strategy: 'auto_from_workspace' },
  backendPreference: {
    device: ['appium', 'mock'],
  },
  execution: {
    prefer: 'device_backend' as const,
    fallback: 'abort' as const,
    features: ['Login Flow'],
    testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
    assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' as const },
    metrics: ['launch_time', 'crash'],
  },
  artifacts: {
    collect: ['screenshot', 'video', 'syslog', 'crashlog', 'uitree'],
    report: {
      outputs: ['summary_md', 'result_json', 'artifact_index_json'],
    },
  },
  performance: {
    baseline: 'local_auto' as const,
    baselineDomain: 'physical' as const,
    thresholdRequired: false,
  },
  safety: {
    defaultMode: 'ask' as const,
    highRiskActions: ['clear_data', 'reinstall'],
  },
};

function makeInput(overrides?: Partial<BuildContextInput>): BuildContextInput {
  return {
    projectProfile: MOCK_PROFILE,
    intent: MOCK_INTENT,
    testPlan: MOCK_TEST_PLAN,
    runState: 'awaiting_confirm',
    previousSteps: [],
    ...overrides,
  };
}

function makeBuilder(opts?: ConstructorParameters<typeof ContextBuilder>[0]): ContextBuilder {
  return new ContextBuilder(opts);
}

// ─── ADR-010 §11: Secret filtering ──────────────────────────

describe('ADR-010 §11: secret sanitization — secrets MUST NOT enter model context', () => {
  test('sanitizeText removes OpenAI-style API keys (sk-...)', () => {
    const cb = makeBuilder();
    const input =
      'Authorization: Bearer sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz';
    const result = cb.sanitizeText(input);
    expect(result).not.toContain('sk-proj');
    expect(result).toContain('[REDACTED]');
  });

  test('sanitizeText removes Bearer JWT tokens', () => {
    const cb = makeBuilder();
    const input =
      'header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN';
    const result = cb.sanitizeText(input);
    expect(result).not.toContain('eyJhbGci');
    expect(result).toContain('[REDACTED]');
  });

  test('sanitizeText removes key=value token patterns', () => {
    const cb = makeBuilder();
    const input = 'export token=ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    const result = cb.sanitizeText(input);
    expect(result).not.toContain('ghp_');
    expect(result).not.toContain('1234567890abcdef');
    expect(result).toContain('[REDACTED]');
  });

  test('sanitizeText removes password=value patterns', () => {
    const cb = makeBuilder();
    const input = 'login with password=SuperSecret123! into the app';
    const result = cb.sanitizeText(input);
    expect(result).not.toContain('SuperSecret123');
    expect(result).toContain('[REDACTED]');
  });

  test('sanitizeText removes apikey=value patterns', () => {
    const cb = makeBuilder();
    const input = 'config: apikey=sk-ant-api-03-abcdefghijklmnopqrstuvwxyz123456789';
    const result = cb.sanitizeText(input);
    expect(result).not.toContain('sk-ant-api');
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result).toContain('[REDACTED]');
  });

  test('sanitizeText removes authorization: header patterns', () => {
    const cb = makeBuilder();
    const input = 'x-api-key: phc_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH';
    const result = cb.sanitizeText(input);
    expect(result).not.toContain('phc_');
    expect(result).toContain('[REDACTED]');
  });

  test('sanitizeText is idempotent — double sanitize = single sanitize', () => {
    const cb = makeBuilder();
    const input = 'token=abc123secret';
    const once = cb.sanitizeText(input);
    const twice = cb.sanitizeText(once);
    expect(twice).toBe(once);
  });

  test('sanitizeText preserves non-secret content', () => {
    const cb = makeBuilder();
    const input =
      'User wants to test login flow with username test@example.com and device iPhone 14';
    const result = cb.sanitizeText(input);
    expect(result).toContain('test@example.com');
    expect(result).toContain('iPhone 14');
    expect(result).toContain('login flow');
  });

  test('custom secret patterns are applied alongside defaults', () => {
    // Providing custom patterns replaces defaults — verify both custom pattern
    // and a known default pattern (token=) work.
    const cb = new ContextBuilder({
      secretPatterns: [
        /\bmy-custom-token:\s*\S{10,}/gi,
        // Also include a default-like pattern to ensure token matching still works
        /\b(?:token|password|secret|api[_-]?key|credential)\s*[=:]\s*["']?[^\s"']{8,}["']?/gi,
      ],
    });
    const input =
      'my-custom-token: VERY-LONG-SECRET-VALUE-HERE and also token=another-secret-123456789';
    const result = cb.sanitizeText(input);
    expect(result).not.toContain('VERY-LONG-SECRET-VALUE-HERE');
    expect(result).not.toContain('another-secret-123456789');
    expect(result).toContain('[REDACTED]');
  });

  test('custom secret placeholder is used instead of default', () => {
    const cb = new ContextBuilder({ secretPlaceholder: '***' });
    const input = 'token=secret12345678';
    const result = cb.sanitizeText(input);
    expect(result).not.toContain('secret12345678');
    expect(result).toContain('***');
    expect(result).not.toContain('[REDACTED]');
  });
});

// ─── ADR-010 §11: Evidence truncation ────────────────────────

describe('ADR-010 §11: evidence truncation — large raw evidence MUST be truncated', () => {
  test('truncateEvidence leaves short text unchanged', () => {
    const cb = makeBuilder();
    const text = 'Short evidence text';
    const result = cb.truncateEvidence(text);
    expect(result).toBe(text);
  });

  test('truncateEvidence truncates text exceeding default limit (4096 chars)', () => {
    const cb = makeBuilder();
    // Create a string of 10000 chars
    const longText = 'A'.repeat(10000);
    const result = cb.truncateEvidence(longText);
    expect(result.length).toBeLessThanOrEqual(4096 + 100); // allow overhead for truncation notice
    expect(result).toContain('truncated');
  });

  test('truncateEvidence preserves head and tail of truncated content', () => {
    const cb = makeBuilder();
    const head = 'HEAD-'.repeat(100); // 500 chars
    const body = 'BODY-'.repeat(2000); // 10000 chars
    const tail = '-TAIL'.repeat(100); // 500 chars
    const longText = head + body + tail;

    const result = cb.truncateEvidence(longText);
    expect(result.startsWith('HEAD-')).toBe(true);
    expect(result.endsWith('-TAIL')).toBe(true);
    expect(result).toContain('truncated');
  });

  test('truncateEvidence respects custom maxLength', () => {
    const cb = new ContextBuilder({ maxEvidenceChars: 500 });
    const longText = 'B'.repeat(2000);
    const result = cb.truncateEvidence(longText);
    expect(result.length).toBeLessThanOrEqual(500 + 100);
    expect(result).toContain('truncated');
  });

  test('truncateEvidence per-call maxLength overrides instance default', () => {
    const cb = new ContextBuilder({ maxEvidenceChars: 4096 });
    const longText = 'C'.repeat(8000);
    const result = cb.truncateEvidence(longText, 200);
    expect(result.length).toBeLessThanOrEqual(200 + 100);
  });

  test('truncateEvidence reports correct number of truncated characters', () => {
    const cb = new ContextBuilder({ maxEvidenceChars: 1000 });
    const longText = 'X'.repeat(5000);
    const result = cb.truncateEvidence(longText);
    // 5000 - 1000 = 4000 truncated
    expect(result).toContain('[4000');
  });
});

// ─── System prompt assembly ──────────────────────────────────

describe('buildSystemPrompt: structured markdown context assembly', () => {
  test('buildSystemPrompt includes all four sections', () => {
    const cb = makeBuilder();
    const input = makeInput();
    const prompt = cb.buildSystemPrompt(input);

    expect(prompt).toContain('## Project Profile');
    expect(prompt).toContain('## Intent');
    expect(prompt).toContain('## Test Plan');
    expect(prompt).toContain('## Run State');
  });

  test('buildSystemPrompt includes project app name and bundleId', () => {
    const cb = makeBuilder();
    const prompt = cb.buildSystemPrompt(makeInput());

    expect(prompt).toContain('TestApp');
    expect(prompt).toContain('com.example.TestApp');
    expect(prompt).toContain('TestApp.xcworkspace');
  });

  test('buildSystemPrompt includes confirmed features only', () => {
    const cb = makeBuilder();
    const prompt = cb.buildSystemPrompt(makeInput());

    expect(prompt).toContain('Login Flow');
    expect(prompt).toContain('90%');
    // Settings is not confirmed, should not appear in confirmed features section
    // (it's filtered by f.confirmed)
    expect(prompt).not.toContain('Settings Flow (confidence');
  });

  test('buildSystemPrompt includes XCUITest availability', () => {
    const cb = makeBuilder();
    const prompt = cb.buildSystemPrompt(makeInput());

    expect(prompt).toMatch(/XCUITest Available.*Yes/);
    expect(prompt).toMatch(/TestAppTests/);
  });

  test('buildSystemPrompt handles no XCUITest', () => {
    const cb = makeBuilder();
    const profile: ProjectProfile = {
      ...MOCK_PROFILE,
      testAssets: { hasXCUITest: false, hasScheme: true },
    };
    const prompt = cb.buildSystemPrompt(makeInput({ projectProfile: profile }));

    expect(prompt).toMatch(/XCUITest Available.*No/);
  });

  test('buildSystemPrompt includes intent goal and scope', () => {
    const cb = makeBuilder();
    const prompt = cb.buildSystemPrompt(makeInput());

    expect(prompt).toContain('Test the login flow');
    expect(prompt).toContain('smoke');
    expect(prompt).toContain('physical');
  });

  test('buildSystemPrompt gracefully handles missing intent', () => {
    const cb = makeBuilder();
    const prompt = cb.buildSystemPrompt(makeInput({ intent: undefined }));

    expect(prompt).toContain('No explicit intent provided');
  });

  test('buildSystemPrompt gracefully handles missing testPlan', () => {
    const cb = makeBuilder();
    const prompt = cb.buildSystemPrompt(makeInput({ testPlan: undefined }));

    expect(prompt).toContain('No test plan compiled yet');
  });

  test('buildSystemPrompt includes run state value', () => {
    const cb = makeBuilder();
    const prompt = cb.buildSystemPrompt(makeInput({ runState: 'executing' }));

    expect(prompt).toContain('`executing`');
  });

  test('buildSystemPrompt handles empty previousSteps gracefully', () => {
    const cb = makeBuilder();
    const prompt = cb.buildSystemPrompt(makeInput({ previousSteps: [] }));

    expect(prompt).toContain('Previous Steps');
    expect(prompt).toContain('_none_');
  });

  test('buildSystemPrompt sanitizes secrets in profile data', () => {
    const cb = makeBuilder();
    const input = makeInput({
      intent: {
        ...MOCK_INTENT,
        goal: 'Test with token=sk-abc123secret in description',
      },
    });
    const prompt = cb.buildSystemPrompt(input);
    expect(prompt).not.toContain('sk-abc123secret');
    expect(prompt).toContain('[REDACTED]');
  });

  test('buildSystemPrompt with no confirmed features shows confirmed section without entries', () => {
    const cb = makeBuilder();
    const profile: ProjectProfile = {
      ...MOCK_PROFILE,
      features: [],
    };
    const prompt = cb.buildSystemPrompt(makeInput({ projectProfile: profile }));
    // No "Confirmed Features" heading since there are none
    expect(prompt).not.toContain('Confirmed Features');
  });
});

// ─── Turn assembly ───────────────────────────────────────────

describe('buildTurn: AgentTurnInput construction', () => {
  test('buildTurn returns structured AgentTurnInput with messages array', () => {
    const cb = makeBuilder();
    const turn = cb.buildTurn(makeInput());

    expect(turn).toHaveProperty('messages');
    expect(Array.isArray(turn.messages)).toBe(true);
    expect(turn.messages.length).toBeGreaterThanOrEqual(1);
  });

  test('buildTurn first message is system prompt', () => {
    const cb = makeBuilder();
    const turn = cb.buildTurn(makeInput());

    const first = turn.messages[0] as Record<string, unknown>;
    expect(first.role).toBe('system');
    expect(typeof first.content).toBe('string');
    expect(first.content as string).toContain('## Project Profile');
  });

  test('buildTurn appends user messages after system prompt', () => {
    const cb = makeBuilder();
    const userMessages = [
      { role: 'user', content: 'Show me the current device list' },
      { role: 'assistant', content: 'Here are the connected devices...' },
    ];
    const turn = cb.buildTurn(makeInput(), userMessages);

    expect(turn.messages.length).toBe(3); // system + 2 user messages
    const second = turn.messages[1] as Record<string, unknown>;
    expect(second.role).toBe('user');
    expect(second.content).toBe('Show me the current device list');
  });

  test('buildTurn with empty userMessages array produces only system message', () => {
    const cb = makeBuilder();
    const turn = cb.buildTurn(makeInput(), []);

    expect(turn.messages.length).toBe(1);
  });

  test('buildTurn sanitizes secrets in all context', () => {
    const cb = makeBuilder();
    const input = makeInput({
      intent: {
        ...MOCK_INTENT,
        goal: 'Run test using API key: apikey=sk-test-secret-key-abcdef123456',
      },
    });
    const turn = cb.buildTurn(input);

    const first = turn.messages[0] as Record<string, unknown>;
    const content = first.content as string;
    expect(content).not.toContain('sk-test-secret-key');
    expect(content).toContain('[REDACTED]');
  });
});

// ─── Edge cases ──────────────────────────────────────────────

describe('edge cases', () => {
  test('buildSystemPrompt with minimal input (only profile + runState) does not throw', () => {
    const cb = makeBuilder();
    expect(() =>
      cb.buildSystemPrompt({
        projectProfile: MOCK_PROFILE,
        runState: 'created',
      }),
    ).not.toThrow();
  });

  test('buildSystemPrompt with all fields null/empty works', () => {
    const cb = makeBuilder();
    const minimalProfile: ProjectProfile = {
      schemaVersion: 'itestagent.project-profile.v1' as const,
      projectHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      app: {},
      targets: [],
      testAssets: { hasXCUITest: false, hasScheme: false },
      features: [],
      suggestedSmoke: [],
    };
    const prompt = cb.buildSystemPrompt({
      projectProfile: minimalProfile,
      runState: 'created',
    });
    expect(prompt).toContain('## Project Profile');
    expect(prompt).toContain('## Run State');
  });

  test('sanitizeText handles empty string', () => {
    const cb = makeBuilder();
    expect(cb.sanitizeText('')).toBe('');
  });

  test('truncateEvidence handles empty string', () => {
    const cb = makeBuilder();
    expect(cb.truncateEvidence('')).toBe('');
  });

  test('truncateEvidence handles text exactly at limit', () => {
    const cb = new ContextBuilder({ maxEvidenceChars: 100 });
    const text = 'A'.repeat(100);
    const result = cb.truncateEvidence(text);
    expect(result).toBe(text); // should not be truncated
    expect(result).not.toContain('truncated');
  });

  test('truncateEvidence handles text one char over limit', () => {
    const cb = new ContextBuilder({ maxEvidenceChars: 100 });
    const text = 'B'.repeat(101);
    const result = cb.truncateEvidence(text);
    expect(result).toContain('truncated');
  });

  test('buildSystemPrompt with previous steps includes them', () => {
    const cb = makeBuilder();
    const steps: RunStep[] = [
      {
        stepId: 'step-1',
        backend: 'appium',
        action: 'launchApp',
        target: 'com.example.TestApp',
        input: {},
        result: { status: 'ok' },
        artifacts: [],
        safetyGate: 'allow',
        startedAt: '2026-01-01T00:00:00Z',
        durationMs: 1500,
      },
      {
        stepId: 'step-2',
        backend: 'appium',
        action: 'tap',
        target: 'loginButton',
        input: { x: 0.5, y: 0.8 },
        result: { status: 'ok' },
        artifacts: ['screenshot-1'],
        startedAt: '2026-01-01T00:00:02Z',
        durationMs: 300,
      },
    ];
    const prompt = cb.buildSystemPrompt(makeInput({ previousSteps: steps }));
    expect(prompt).toMatch(/step-1/);
    expect(prompt).toMatch(/launchApp/);
    expect(prompt).toMatch(/appium/);
    expect(prompt).toMatch(/1500ms/);
    expect(prompt).toMatch(/\[allow\]/);
    expect(prompt).toMatch(/step-2/);
    expect(prompt).toMatch(/tap/);
    expect(prompt).toMatch(/300ms/);
  });

  test('default constructor creates valid ContextBuilder', () => {
    const cb = new ContextBuilder();
    const input = makeInput();
    const prompt = cb.buildSystemPrompt(input);
    expect(prompt.length).toBeGreaterThan(0);
  });

  test('custom maxEvidenceChars is respected by truncateEvidence', () => {
    const cb = new ContextBuilder({ maxEvidenceChars: 300 });
    const longText = 'Z'.repeat(5000);
    const result = cb.truncateEvidence(longText);
    expect(result.length).toBeLessThanOrEqual(300 + 100);
  });
});
