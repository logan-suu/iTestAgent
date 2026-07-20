/**
 * TuiShell plan review mode reducer tests.
 *
 * US-5.2 AC1-AC3: enter_plan_review, plan_confirm, plan_cancel,
 * section navigation, natural language modification.
 * Pattern follows tui-shell-candidate.test.ts.
 */
import { describe, expect, it } from 'bun:test';
import type { TestPlan } from 'itestagent-contracts';
import {
  type TuiShellEvent,
  type TuiShellState,
  createInitialState,
  tuiShellReducer,
} from '../src/tui-shell.js';

// ─── Test helpers ───────────────────────────────────────────

function makeTestPlan(overrides: Partial<TestPlan> = {}): TestPlan {
  return {
    schemaVersion: 'itestagent.test-plan.v1' as const,
    runId: 'run-001',
    projectProfileRef: '/tmp/profile.json',
    target: { type: 'current_workspace' },
    device: { kind: 'physical', physical: { selector: 'local_connected' } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: 'auto',
      fallback: 'device_backend',
      features: ['login', 'checkout'],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      metrics: ['launch_time', 'memory_peak'],
    },
    artifacts: {
      collect: ['screenshot', 'crashlog'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'local_auto', baselineDomain: 'physical', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: ['clear_data'] },
    ...overrides,
  };
}

function enterPlanReview(state: TuiShellState, plan: TestPlan): TuiShellState {
  return tuiShellReducer(state, { type: 'enter_plan_review', plan });
}

// ─── enter_plan_review ──────────────────────────────────────

describe('enter_plan_review event', () => {
  it('switches mode to plan_review', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const next = tuiShellReducer(state, { type: 'enter_plan_review', plan });
    expect(next.mode).toBe('plan_review');
  });

  it('stores the plan and resets navigation', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const next = tuiShellReducer(state, { type: 'enter_plan_review', plan });
    expect(next.plan).toEqual(plan);
    expect(next.planSectionIndex).toBe(0);
    expect(next.planModifyMode).toBe(false);
    expect(next.planModifyDraft).toBe('');
  });
});

// ─── exit_plan_review ───────────────────────────────────────

describe('exit_plan_review event', () => {
  it('switches mode back to chat', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, { type: 'exit_plan_review' });
    expect(next.mode).toBe('chat');
  });

  it('keeps plan data for engine access', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, { type: 'exit_plan_review' });
    expect(next.plan).toEqual(plan);
  });
});

// ─── plan_confirm ───────────────────────────────────────────

describe('plan_confirm event', () => {
  it('sets planConfirmed to true', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, { type: 'plan_confirm' });
    expect(next.planConfirmed).toBe(true);
  });

  it('switches mode back to chat on confirm', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, { type: 'plan_confirm' });
    expect(next.mode).toBe('chat');
  });
});

// ─── plan_cancel ────────────────────────────────────────────

describe('plan_cancel event', () => {
  it('sets planConfirmed to false', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, { type: 'plan_cancel' });
    expect(next.planConfirmed).toBe(false);
  });

  it('sets plan to null on cancel', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, { type: 'plan_cancel' });
    expect(next.plan).toBeNull();
  });

  it('switches mode back to chat on cancel', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, { type: 'plan_cancel' });
    expect(next.mode).toBe('chat');
  });
});

// ─── plan_navigate_section ──────────────────────────────────

describe('plan_navigate_section event', () => {
  it('moves section index down', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, {
      type: 'plan_navigate_section',
      direction: 'down',
    });
    expect(next.planSectionIndex).toBe(1);
  });

  it('moves section index up', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const atSection2 = tuiShellReducer(review, {
      type: 'plan_navigate_section',
      direction: 'down',
    });
    const backUp = tuiShellReducer(atSection2, {
      type: 'plan_navigate_section',
      direction: 'up',
    });
    expect(backUp.planSectionIndex).toBe(0);
  });

  it('wraps around from last to first', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    let current = review;
    // Navigate through all 7 sections
    for (let i = 0; i < 7; i++) {
      current = tuiShellReducer(current, {
        type: 'plan_navigate_section',
        direction: 'down',
      });
    }
    expect(current.planSectionIndex).toBe(0);
  });
});

// ─── plan modification (AC2: natural language) ──────────────

describe('plan modification events', () => {
  it('plan_start_modify enters modify mode', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const next = tuiShellReducer(review, { type: 'plan_start_modify' });
    expect(next.planModifyMode).toBe(true);
    expect(next.planModifyDraft).toBe('');
  });

  it('plan_modify_input updates draft', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const modifying = tuiShellReducer(review, { type: 'plan_start_modify' });
    const next = tuiShellReducer(modifying, {
      type: 'plan_modify_input',
      text: '只跑登录，不要下单',
    });
    expect(next.planModifyDraft).toBe('只跑登录，不要下单');
  });

  it('plan_modify_submit exits modify mode and switches to chat with modify text', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const modifying = tuiShellReducer(review, { type: 'plan_start_modify' });
    const typed = tuiShellReducer(modifying, {
      type: 'plan_modify_input',
      text: 'remove checkout feature',
    });
    const submitted = tuiShellReducer(typed, { type: 'plan_modify_submit' });
    expect(submitted.planModifyMode).toBe(false);
    expect(submitted.mode).toBe('chat');
    expect(submitted.planModifyDraft).toBe('remove checkout feature');
  });

  it('plan_modify_cancel exits modify mode without changing plan', () => {
    const state = createInitialState('/test');
    const plan = makeTestPlan();
    const review = enterPlanReview(state, plan);
    const modifying = tuiShellReducer(review, { type: 'plan_start_modify' });
    const typed = tuiShellReducer(modifying, {
      type: 'plan_modify_input',
      text: 'discard me',
    });
    const cancelled = tuiShellReducer(typed, { type: 'plan_modify_cancel' });
    expect(cancelled.planModifyMode).toBe(false);
    expect(cancelled.planModifyDraft).toBe('');
    expect(cancelled.plan).toEqual(plan);
  });
});

// ─── Default state ──────────────────────────────────────────

describe('deafult state fields for plan review', () => {
  it('createInitialState has null plan and chat mode', () => {
    const state = createInitialState('/test');
    expect(state.mode).toBe('chat');
    expect(state.plan).toBeNull();
    expect(state.planSectionIndex).toBe(0);
    expect(state.planModifyMode).toBe(false);
    expect(state.planModifyDraft).toBe('');
    expect(state.planConfirmed).toBe(false);
  });
});
