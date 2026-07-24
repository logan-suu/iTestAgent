/**
 * Phase 3 integration — AssertionEvaluator: 4-tier assertion strategy across contracts + engine.
 *
 * Cross-package chain: itestagent-contracts (AssertionCondition, UserAssertion,
 * AssertionEvaluateInputSchema, AssertionEvaluateOutputSchema) + itestagent-engine (AssertionEvaluator).
 *
 * Task 3.14 compliance: Verify assertion evaluation across all 4 tiers.
 * US-11.1 AC1 (user assertions), AC2 (profile targets), AC3 (agent suggested/confirmed).
 */
import { describe, expect, it } from 'bun:test';
import { AssertionConditionTypeSchema, AssertionEvaluateOutputSchema } from 'itestagent-contracts';
import { AssertionEvaluator } from 'itestagent-engine';

describe('Phase 3 AssertionEvaluator integration', () => {
  const evaluator = new AssertionEvaluator();

  it('Tier 1: user assertions evaluate to passed when conditions satisfied', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      userAssertions: [
        {
          id: 'ua-1',
          caseId: 'login',
          source: 'user' as const,
          conditions: [
            {
              type: 'element_visible' as const,
              description: 'Home screen visible',
              target: 'homeScreen',
            },
          ],
        },
      ],
      observations: { login: { homeScreen_visible: true } },
    });

    expect(AssertionEvaluateOutputSchema.safeParse(output).success).toBe(true);
    expect(output.status).toBe('passed');
  });

  it('Tier 1: user assertion fails when condition unsatisfied', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      userAssertions: [
        {
          id: 'ua-2',
          caseId: 'dashboard',
          source: 'user' as const,
          conditions: [
            {
              type: 'element_visible' as const,
              description: 'Dashboard visible',
              target: 'dashboard',
            },
          ],
        },
      ],
      observations: { dashboard: { dashboard_visible: false } },
    });

    expect(output.status).toBe('failed');
  });

  it('Tier 1: all conditions must pass', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      userAssertions: [
        {
          id: 'ua-3',
          caseId: 'login',
          source: 'user' as const,
          conditions: [
            {
              type: 'element_text' as const,
              description: 'Welcome text',
              target: 'label',
              expected: 'Welcome',
            },
            {
              type: 'element_text' as const,
              description: 'Settings text',
              target: 'label',
              expected: 'Settings',
            },
          ],
        },
      ],
      observations: { login: { label_text: 'Welcome to the app' } },
    });

    expect(output.status).toBe('failed');
  });

  it('Tier 2: profile assertions evaluate when no user assertions', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      profileAssertions: [
        {
          id: 'pa-1',
          caseId: 'login',
          source: 'profile' as const,
          conditions: [
            {
              type: 'element_visible' as const,
              description: 'Login button visible',
              target: 'loginButton',
            },
            {
              type: 'element_visible' as const,
              description: 'Password field visible',
              target: 'passwordField',
            },
          ],
        },
      ],
      observations: { login: { loginButton_visible: true, passwordField_visible: true } },
    });

    expect(output.status).toBe('passed');
  });

  it('Tier 2: profile assertion failure', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      profileAssertions: [
        {
          id: 'pa-2',
          caseId: 'login',
          source: 'profile' as const,
          conditions: [
            {
              type: 'element_visible' as const,
              description: 'Missing button',
              target: 'missingButton',
            },
          ],
        },
      ],
      observations: { login: { missingButton_visible: false } },
    });

    expect(output.status).toBe('failed');
  });

  it('Tier 3: agent confirmed assertions evaluate', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      agentConfirmed: [
        {
          id: 'ac-1',
          caseId: 'home',
          source: 'agent_confirmed' as const,
          conditions: [
            {
              type: 'element_text' as const,
              description: 'Welcome message',
              target: 'welcome',
              expected: 'Welcome',
            },
          ],
        },
      ],
      observations: { home: { welcome_text: 'Welcome to the app' } },
    });

    expect(output.status).toBe('passed');
  });

  it('Tier 3: unconfirmed suggestions return needs_assertion', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      agentSuggestions: [
        {
          id: 'as-1',
          caseId: 'dashboard',
          source: 'agent' as const,
          conditions: [
            {
              type: 'element_visible' as const,
              description: 'Dashboard should appear',
              target: 'dashboard',
            },
          ],
        },
      ],
      observations: {},
    });

    expect(output.status).toBe('needs_assertion');
    expect(output.suggestions).toBeDefined();
    expect(output.suggestions?.length).toBeGreaterThanOrEqual(1);
  });

  it('Tier 4: explore_only policy returns explored', () => {
    const output = evaluator.evaluate({ policy: 'explore_only' });
    expect(output.status).toBe('explored');
  });

  it('Tier 4: no assertions available returns explored', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
    });
    expect(output.status).toBe('explored');
  });

  it('user assertions take priority over profile (Tier 1 > Tier 2)', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      userAssertions: [
        {
          id: 'ua-pri',
          caseId: 'login',
          source: 'user' as const,
          conditions: [
            { type: 'element_visible' as const, description: 'Home screen', target: 'home' },
          ],
        },
      ],
      profileAssertions: [
        {
          id: 'pa-pri',
          caseId: 'login',
          source: 'profile' as const,
          conditions: [
            { type: 'element_visible' as const, description: 'Profile', target: 'profile' },
          ],
        },
      ],
      observations: { login: { home_visible: true } },
    });

    expect(output.status).toBe('passed');
  });

  it('profile assertions take priority over agent suggestions (Tier 2 > Tier 3)', () => {
    const output = evaluator.evaluate({
      policy: 'user_goal_then_profile_then_agent_confirmed',
      profileAssertions: [
        {
          id: 'pa-pri',
          caseId: 'home',
          source: 'profile' as const,
          conditions: [
            { type: 'element_visible' as const, description: 'Home screen', target: 'home' },
          ],
        },
      ],
      agentSuggestions: [
        {
          id: 'as-pri',
          caseId: 'home',
          source: 'agent' as const,
          conditions: [
            { type: 'element_visible' as const, description: 'Dashboard', target: 'dashboard' },
          ],
        },
      ],
      observations: { home: { home_visible: true } },
    });

    expect(output.status).toBe('passed');
  });

  it('AssertionEvaluateOutput passes schema validation', () => {
    const output = evaluator.evaluate({ policy: 'explore_only' });
    expect(AssertionEvaluateOutputSchema.safeParse(output).success).toBe(true);
  });

  it('AssertionConditionTypeSchema validates known types', () => {
    const types = [
      'element_visible',
      'element_text',
      'element_disabled',
      'navigation_reached',
      'no_crash',
      'custom',
    ];
    for (const t of types) {
      expect(AssertionConditionTypeSchema.safeParse(t).success).toBe(true);
    }
  });
});
