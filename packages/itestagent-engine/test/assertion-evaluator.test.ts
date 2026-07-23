import { describe, expect, it } from 'bun:test';
import type { UserAssertion } from 'itestagent-contracts';
import { AssertionEvaluator } from '../src/assertion/assertion-evaluator.js';

function makeUserAssertion(
  id: string,
  caseId: string,
  source: 'user' | 'profile' | 'agent' | 'agent_confirmed',
  conditions: UserAssertion['conditions'],
  evidence?: string[],
): UserAssertion {
  return { id, caseId, source, conditions, evidence };
}

function makeCondition(
  type:
    | 'element_visible'
    | 'element_text'
    | 'element_disabled'
    | 'navigation_reached'
    | 'no_crash'
    | 'custom',
  description: string,
  target?: string,
): UserAssertion['conditions'][number] {
  return { type, description, target: target ?? undefined };
}

describe('AssertionEvaluator', () => {
  const evaluator = new AssertionEvaluator();

  // ─── AC1: Priority Tiers ──────────────────────────────────────

  describe('AC1: priority tiers', () => {
    it('tier 1: user assertions take highest priority over profile assertions', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'login', 'user', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
        ],
        profileAssertions: [
          makeUserAssertion('p1', 'login', 'profile', [
            makeCondition('element_visible', 'Welcome', 'welcome_label'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true },
        },
      });
      expect(result.status).toBe('passed');
      expect(result.cases[0]?.resolvedBy).toBe('user');
    });

    it('tier 2: profile assertions used when no user assertions exist', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        profileAssertions: [
          makeUserAssertion('p1', 'login', 'profile', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true },
        },
      });
      expect(result.status).toBe('passed');
      expect(result.cases[0]?.resolvedBy).toBe('profile');
    });

    it('tier 3: agent_confirmed assertions used when no user or profile assertions', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        agentConfirmed: [
          makeUserAssertion('a1', 'login', 'agent_confirmed', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true },
        },
      });
      expect(result.status).toBe('passed');
      expect(result.cases[0]?.resolvedBy).toBe('agent_confirmed');
    });

    it('tier 3 unconfirmed: agent suggestions → needs_assertion (AC4)', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        agentSuggestions: [
          makeUserAssertion('s1', 'login', 'agent', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true },
        },
      });
      expect(result.status).toBe('needs_assertion');
      expect(result.suggestions).toHaveLength(1);
    });

    it('tier 4: explore_only policy → explored', () => {
      const result = evaluator.evaluate({
        policy: 'explore_only',
      });
      expect(result.status).toBe('explored');
    });

    it('no assertions at all → explored', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
      });
      expect(result.status).toBe('explored');
    });
  });

  // ─── AC2: Passed when explicit assertions exist ───────────────

  describe('AC2: passed when explicit assertions exist', () => {
    it('all conditions satisfied → passed', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'login', 'user', [
            makeCondition('element_visible', 'Login button', 'login_button'),
            makeCondition('element_text', 'Welcome', 'welcome_label'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true, welcome_label_text: 'Welcome' },
        },
      });
      expect(result.status).toBe('passed');
      expect(result.cases[0]?.status).toBe('passed');
    });

    it('any condition unsatisfied → failed', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'login', 'user', [
            makeCondition('element_visible', 'Login button', 'login_button'),
            {
              type: 'element_text' as const,
              description: 'Welcome',
              target: 'welcome_label',
              expected: 'Welcome',
            },
          ]),
        ],
        observations: {
          login: { login_button_visible: true, welcome_label_text: 'Error' },
        },
      });
      expect(result.status).toBe('failed');
      expect(result.cases[0]?.status).toBe('failed');
    });

    it('single satisfied condition → passed', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'login', 'user', [
            makeCondition('no_crash', 'No crash', undefined),
          ]),
        ],
        observations: {
          login: { crashDetected: false },
        },
      });
      expect(result.status).toBe('passed');
    });
  });

  // ─── AC3: No assertions → cannot pass ────────────────────────

  describe('AC3: no assertions → explored/inconclusive/needs_assertion', () => {
    it('explore_only policy → explored (not passed)', () => {
      const result = evaluator.evaluate({
        policy: 'explore_only',
      });
      expect(result.status).toBe('explored');
      expect(result.status).not.toBe('passed');
    });

    it('agent suggestions without confirmation → needs_assertion (not passed)', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        agentSuggestions: [
          makeUserAssertion('s1', 'login', 'agent', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
        ],
      });
      expect(result.status).toBe('needs_assertion');
      expect(result.status).not.toBe('passed');
    });

    it('condition unchecked (observation missing) → inconclusive', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'login', 'user', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
        ],
        observations: {},
      });
      expect(result.status).toBe('inconclusive');
      expect(result.status).not.toBe('passed');
    });

    it('mixed: some checked + some unchecked → inconclusive', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'login', 'user', [
            makeCondition('element_visible', 'Login button', 'login_button'),
            makeCondition('element_text', 'Welcome', 'welcome_label'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true },
        },
      });
      expect(result.status).toBe('inconclusive');
    });
  });

  // ─── AC4: Agent-suggested assertions ─────────────────────────

  describe('AC4: agent suggestions with evidence', () => {
    it('returns suggestions in the output for needs_assertion status', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        agentSuggestions: [
          makeUserAssertion(
            's1',
            'login',
            'agent',
            [makeCondition('element_visible', 'Login button', 'login_button')],
            ['Screenshot after launch shows login button'],
          ),
        ],
      });
      expect(result.status).toBe('needs_assertion');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions?.[0]?.evidence).toContain(
        'Screenshot after launch shows login button',
      );
    });
  });

  // ─── Condition Type Coverage ──────────────────────────────────

  describe('condition types', () => {
    it('element_visible: satisfied when observation is true', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'home', 'user', [
            makeCondition('element_visible', 'Home button', 'home_button'),
          ]),
        ],
        observations: { home: { home_button_visible: true } },
      });
      expect(result.status).toBe('passed');
    });

    it('element_visible: unsatisfied when observation is false', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'home', 'user', [
            makeCondition('element_visible', 'Home button', 'home_button'),
          ]),
        ],
        observations: { home: { home_button_visible: false } },
      });
      expect(result.status).toBe('failed');
    });

    it('element_text: satisfied when observation contains expected text (case-insensitive)', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'home', 'user', [
            {
              type: 'element_text',
              description: 'Welcome text',
              target: 'welcome_label',
              expected: 'welcome',
            },
          ]),
        ],
        observations: { home: { welcome_label_text: 'Welcome back' } },
      });
      expect(result.status).toBe('passed');
    });

    it('element_text: unsatisfied when observation does not contain expected text', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'home', 'user', [
            {
              type: 'element_text',
              description: 'Welcome text',
              target: 'welcome_label',
              expected: 'hello',
            },
          ]),
        ],
        observations: { home: { welcome_label_text: 'Welcome back' } },
      });
      expect(result.status).toBe('failed');
    });

    it('element_disabled: satisfied when enabled is false', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'form', 'user', [
            makeCondition('element_disabled', 'Submit disabled', 'submit_button'),
          ]),
        ],
        observations: { form: { submit_button_enabled: false } },
      });
      expect(result.status).toBe('passed');
    });

    it('element_disabled: unsatisfied when enabled is true', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'form', 'user', [
            makeCondition('element_disabled', 'Submit disabled', 'submit_button'),
          ]),
        ],
        observations: { form: { submit_button_enabled: true } },
      });
      expect(result.status).toBe('failed');
    });

    it('navigation_reached: satisfied when observation is true', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'nav', 'user', [
            makeCondition('navigation_reached', 'Home screen', 'home_screen'),
          ]),
        ],
        observations: { nav: { home_screen_reached: true } },
      });
      expect(result.status).toBe('passed');
    });

    it('no_crash: satisfied when crashDetected is false', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'stability', 'user', [
            makeCondition('no_crash', 'No crash', undefined),
          ]),
        ],
        observations: { stability: { crashDetected: false } },
      });
      expect(result.status).toBe('passed');
    });

    it('no_crash: unsatisfied when crashDetected is true', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'stability', 'user', [
            makeCondition('no_crash', 'No crash', undefined),
          ]),
        ],
        observations: { stability: { crashDetected: true } },
      });
      expect(result.status).toBe('failed');
    });

    it('custom: always unchecked (requires human judgment)', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'custom_check', 'user', [
            makeCondition('custom', 'User should land on home', 'redirect'),
          ]),
        ],
        observations: { custom_check: { redirect: true } },
      });
      expect(result.status).toBe('inconclusive');
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────

  describe('edge cases', () => {
    it('multiple cases with mixed results → failed if any fail', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'login', 'user', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
          makeUserAssertion('u2', 'home', 'user', [
            makeCondition('element_visible', 'Home button', 'home_button'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true },
          home: { home_button_visible: false },
        },
      });
      expect(result.status).toBe('failed');
      expect(result.cases).toHaveLength(2);
      expect(result.cases[0]?.status).toBe('passed');
      expect(result.cases[1]?.status).toBe('failed');
    });

    it('empty userAssertions array → falls through to next tier', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [],
      });
      expect(result.status).toBe('explored');
    });

    it('agentConfirmed takes priority over agentSuggestions (confirmed > unconfirmed)', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        agentConfirmed: [
          makeUserAssertion('a1', 'login', 'agent_confirmed', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
        ],
        agentSuggestions: [
          makeUserAssertion('s1', 'home', 'agent', [
            makeCondition('element_visible', 'Home', 'home_button'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true },
        },
      });
      expect(result.status).toBe('passed');
      expect(result.cases[0]?.resolvedBy).toBe('agent_confirmed');
    });

    it('summary contains case counts', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'login', 'user', [
            makeCondition('element_visible', 'Login button', 'login_button'),
          ]),
        ],
        observations: {
          login: { login_button_visible: true },
        },
      });
      expect(result.summary).toContain('passed');
      expect(result.summary).toContain('user');
    });

    it('condition without target (except no_crash) → unchecked', () => {
      const result = evaluator.evaluate({
        policy: 'user_goal_then_profile_then_agent_confirmed',
        userAssertions: [
          makeUserAssertion('u1', 'test', 'user', [
            {
              type: 'element_visible',
              description: 'No target',
            } as UserAssertion['conditions'][number],
          ]),
        ],
        observations: { test: { some_value: true } },
      });
      expect(result.status).toBe('inconclusive');
    });
  });
});
