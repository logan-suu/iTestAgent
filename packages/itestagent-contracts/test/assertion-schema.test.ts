import { describe, expect, it } from 'bun:test';
import {
  AssertionConditionSchema,
  AssertionConditionTypeSchema,
  AssertionEvaluateInputSchema,
  AssertionEvaluateOutputSchema,
  AssertionEvaluationResultSchema,
  AssertionSourceSchema,
  UserAssertionSchema,
} from '../src/assertion.js';

describe('AssertionConditionTypeSchema', () => {
  it('accepts all valid condition types', () => {
    const valid = [
      'element_visible',
      'element_text',
      'element_disabled',
      'navigation_reached',
      'no_crash',
      'custom',
    ];
    for (const type of valid) {
      expect(() => AssertionConditionTypeSchema.parse(type)).not.toThrow();
    }
  });

  it('rejects invalid condition types', () => {
    expect(() => AssertionConditionTypeSchema.parse('invalid_type')).toThrow();
    expect(() => AssertionConditionTypeSchema.parse('')).toThrow();
  });
});

describe('AssertionConditionSchema', () => {
  it('parses a minimal valid condition', () => {
    const result = AssertionConditionSchema.parse({
      type: 'element_visible',
      description: 'Login button should be visible',
      target: 'login_button',
    });
    expect(result.type).toBe('element_visible');
    expect(result.description).toBe('Login button should be visible');
    expect(result.target).toBe('login_button');
    expect(result.satisfied).toBeUndefined();
  });

  it('parses a satisfied condition', () => {
    const result = AssertionConditionSchema.parse({
      type: 'element_visible',
      description: 'Login button visible',
      target: 'login_button',
      satisfied: true,
    });
    expect(result.satisfied).toBe(true);
  });

  it('parses an unsatisfied condition', () => {
    const result = AssertionConditionSchema.parse({
      type: 'element_text',
      description: 'Welcome text',
      target: 'welcome_label',
      expected: 'Welcome back',
      satisfied: false,
    });
    expect(result.satisfied).toBe(false);
    expect(result.expected).toBe('Welcome back');
  });

  it('parses a condition with unchecked reason', () => {
    const result = AssertionConditionSchema.parse({
      type: 'navigation_reached',
      description: 'Home screen should appear',
      target: 'home_screen',
      uncheckedReason: 'Screen not observed during exploration',
    });
    expect(result.satisfied).toBeUndefined();
    expect(result.uncheckedReason).toBe('Screen not observed during exploration');
  });

  it('parses no_crash without target', () => {
    const result = AssertionConditionSchema.parse({
      type: 'no_crash',
      description: 'App should not crash',
      satisfied: true,
    });
    expect(result.type).toBe('no_crash');
    expect(result.target).toBeUndefined();
  });

  it('parses custom condition', () => {
    const result = AssertionConditionSchema.parse({
      type: 'custom',
      description: 'User should be redirected to home',
      target: 'redirect',
      expected: true,
    });
    expect(result.type).toBe('custom');
  });

  it('rejects missing type', () => {
    expect(() =>
      AssertionConditionSchema.parse({
        description: 'no type',
      }),
    ).toThrow();
  });

  it('rejects missing description', () => {
    expect(() =>
      AssertionConditionSchema.parse({
        type: 'element_visible',
      }),
    ).toThrow();
  });
});

describe('AssertionSourceSchema', () => {
  it('accepts all valid sources', () => {
    const valid = ['user', 'profile', 'agent', 'agent_confirmed', 'explore_only'];
    for (const source of valid) {
      expect(() => AssertionSourceSchema.parse(source)).not.toThrow();
    }
  });

  it('rejects invalid source', () => {
    expect(() => AssertionSourceSchema.parse('unknown')).toThrow();
  });
});

describe('UserAssertionSchema', () => {
  it('parses a user assertion with conditions', () => {
    const result = UserAssertionSchema.parse({
      id: 'ua-001',
      caseId: 'login',
      source: 'user',
      conditions: [
        {
          type: 'element_visible',
          description: 'Login button visible',
          target: 'login_button',
        },
      ],
    });
    expect(result.id).toBe('ua-001');
    expect(result.caseId).toBe('login');
    expect(result.source).toBe('user');
    expect(result.conditions).toHaveLength(1);
  });

  it('parses assertion with evidence (AC4)', () => {
    const result = UserAssertionSchema.parse({
      id: 'ua-002',
      caseId: 'home',
      source: 'agent',
      label: 'Home screen visible',
      conditions: [
        {
          type: 'navigation_reached',
          description: 'Home screen reached',
          target: 'home_screen',
        },
      ],
      evidence: ['Screenshot: home_screen_after_login.png', 'UI tree: 120 elements found'],
    });
    expect(result.evidence).toHaveLength(2);
    expect(result.source).toBe('agent');
  });

  it('rejects assertion without conditions', () => {
    expect(() =>
      UserAssertionSchema.parse({
        id: 'ua-003',
        caseId: 'login',
        source: 'user',
        conditions: [],
      }),
    ).toThrow();
  });

  it('rejects assertion with one condition', () => {
    // Should pass — min(1)
    expect(() =>
      UserAssertionSchema.parse({
        id: 'ua-003',
        caseId: 'login',
        source: 'user',
        conditions: [
          {
            type: 'element_visible',
            description: 'test',
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe('AssertionEvaluationResultSchema', () => {
  it('parses evaluation with mixed conditions', () => {
    const result = AssertionEvaluationResultSchema.parse({
      assertionId: 'ua-001',
      caseId: 'login',
      source: 'user',
      satisfiedCount: 2,
      unsatisfiedCount: 1,
      uncheckedCount: 0,
      totalCount: 3,
      conditions: [
        {
          type: 'element_visible',
          description: 'Login button',
          target: 'login_button',
          satisfied: true,
        },
        {
          type: 'element_text',
          description: 'Welcome text',
          target: 'welcome',
          satisfied: true,
        },
        {
          type: 'navigation_reached',
          description: 'Home screen',
          target: 'home',
          satisfied: false,
        },
      ],
    });
    expect(result.satisfiedCount).toBe(2);
    expect(result.unsatisfiedCount).toBe(1);
    expect(result.uncheckedCount).toBe(0);
  });
});

describe('AssertionEvaluateInputSchema', () => {
  it('parses minimal input (explore_only)', () => {
    const result = AssertionEvaluateInputSchema.parse({
      policy: 'explore_only',
    });
    expect(result.policy).toBe('explore_only');
    expect(result.userAssertions).toEqual([]);
    expect(result.observations).toEqual({});
  });

  it('parses input with user assertions and observations', () => {
    const result = AssertionEvaluateInputSchema.parse({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      userAssertions: [
        {
          id: 'ua-001',
          caseId: 'login',
          source: 'user',
          conditions: [
            {
              type: 'element_visible',
              description: 'Login button',
              target: 'login_button',
            },
          ],
        },
      ],
      observations: {
        login: { login_button_visible: true },
      },
    });
    expect(result.userAssertions).toHaveLength(1);
    expect(result.observations).toEqual({
      login: { login_button_visible: true },
    });
  });

  it('accepts all assertion tiers', () => {
    const input = AssertionEvaluateInputSchema.parse({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      userAssertions: [],
      profileAssertions: [],
      agentSuggestions: [],
      agentConfirmed: [],
      observations: {},
    });
    expect(input.userAssertions).toEqual([]);
    expect(input.profileAssertions).toEqual([]);
    expect(input.agentSuggestions).toEqual([]);
    expect(input.agentConfirmed).toEqual([]);
  });
});

describe('AssertionEvaluateOutputSchema', () => {
  it('parses passed output', () => {
    const result = AssertionEvaluateOutputSchema.parse({
      status: 'passed',
      cases: [
        {
          caseId: 'login',
          status: 'passed',
          resolvedBy: 'user',
        },
      ],
      summary: 'All assertions passed.',
    });
    expect(result.status).toBe('passed');
    expect(result.cases).toHaveLength(1);
  });

  it('parses needs_assertion output with suggestions', () => {
    const result = AssertionEvaluateOutputSchema.parse({
      status: 'needs_assertion',
      cases: [],
      summary: 'Agent has suggested assertions. User confirmation required.',
      suggestions: [
        {
          id: 'sug-001',
          caseId: 'login',
          source: 'agent',
          conditions: [
            {
              type: 'element_visible',
              description: 'Login button visible after launch',
              target: 'login_button',
            },
          ],
          evidence: ['App launched successfully, login button detected in UI tree'],
        },
      ],
    });
    expect(result.status).toBe('needs_assertion');
    expect(result.suggestions).toHaveLength(1);
  });

  it('parses explored output', () => {
    const result = AssertionEvaluateOutputSchema.parse({
      status: 'explored',
      cases: [],
      summary: 'Exploration only — no assertions configured.',
    });
    expect(result.status).toBe('explored');
  });

  it('parses failed output', () => {
    const result = AssertionEvaluateOutputSchema.parse({
      status: 'failed',
      cases: [
        {
          caseId: 'login',
          status: 'failed',
          resolvedBy: 'user',
          evaluations: [
            {
              assertionId: 'ua-001',
              caseId: 'login',
              source: 'user',
              satisfiedCount: 1,
              unsatisfiedCount: 1,
              uncheckedCount: 0,
              totalCount: 2,
              conditions: [
                {
                  type: 'element_visible',
                  description: 'Login button',
                  target: 'login_button',
                  satisfied: true,
                },
                {
                  type: 'element_text',
                  description: 'Welcome text',
                  target: 'welcome',
                  satisfied: false,
                },
              ],
            },
          ],
        },
      ],
      summary: 'Status: failed. Source: user. Cases: 1 total (0 passed, 1 failed, 0 inconclusive)',
    });
    expect(result.status).toBe('failed');
    expect(result.cases[0]?.evaluations).toHaveLength(1);
  });
});
