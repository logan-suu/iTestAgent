import { expect, test } from 'bun:test';
import type { RunState } from '../src/run-state.js';
import {
  RUN_STATE_EXCEPTION,
  RUN_STATE_FORWARD,
  RunStateSchema,
  isExceptionState,
  isTerminalState,
  isValidTransition,
} from '../src/run-state.js';

// ─── Test 1: RunStateSchema contains all 15 states ─────────

test('RunStateSchema contains all 15 states', () => {
  const options = RunStateSchema.options as readonly string[];
  expect(options).toHaveLength(15);

  for (const state of RUN_STATE_FORWARD) {
    expect(options).toContain(state);
  }
  for (const state of RUN_STATE_EXCEPTION) {
    expect(options).toContain(state);
  }
});

// ─── Test 2: isValidTransition allows forward transitions ──

test('isValidTransition allows forward transitions', () => {
  // Forward chain: each state can go to the next
  for (let i = 0; i < RUN_STATE_FORWARD.length - 1; i++) {
    const from = RUN_STATE_FORWARD[i] as RunState;
    const to = RUN_STATE_FORWARD[i + 1] as RunState;
    expect(isValidTransition(from, to)).toBe(true);
  }
});

// ─── Test 3: isValidTransition rejects backward transitions ─

test('isValidTransition rejects backward transitions', () => {
  // can't go backwards in the forward chain
  expect(isValidTransition('planning', 'created')).toBe(false);
  expect(isValidTransition('executing', 'preparing_device')).toBe(false);
  expect(isValidTransition('done', 'reported')).toBe(false);
});

// ─── Test 4: isValidTransition allows exception transitions ─

test('isValidTransition allows exception transitions from any forward state (except done)', () => {
  const nonTerminalForward = RUN_STATE_FORWARD.filter((s) => s !== 'done');
  for (const from of nonTerminalForward) {
    for (const to of RUN_STATE_EXCEPTION) {
      expect(isValidTransition(from, to)).toBe(true);
    }
  }
});

// ─── Test 5: isValidTransition allows done after exception ─

test('isValidTransition allows done after exception states', () => {
  for (const from of RUN_STATE_EXCEPTION) {
    expect(isValidTransition(from, 'done')).toBe(true);
  }
});

// ─── Test 6: isValidTransition rejects done→anything ───────

test('isValidTransition rejects transitions from done', () => {
  for (const forward of RUN_STATE_FORWARD) {
    expect(isValidTransition('done', forward)).toBe(false);
  }
  for (const exception of RUN_STATE_EXCEPTION) {
    expect(isValidTransition('done', exception)).toBe(false);
  }
});

// ─── Test 7: isTerminalState correctly identifies terminals ─

test('isTerminalState correctly identifies terminal states', () => {
  // Terminal: done + all exception states
  expect(isTerminalState('done')).toBe(true);
  for (const state of RUN_STATE_EXCEPTION) {
    expect(isTerminalState(state)).toBe(true);
  }

  // Non-terminal: forward states except done
  const nonTerminal = RUN_STATE_FORWARD.slice(0, -1); // exclude 'done'
  for (const state of nonTerminal) {
    expect(isTerminalState(state)).toBe(false);
  }
});

// ─── Test 8: isExceptionState correctly identifies exception ─

test('isExceptionState correctly identifies exception states', () => {
  for (const state of RUN_STATE_EXCEPTION) {
    expect(isExceptionState(state)).toBe(true);
  }
  for (const state of RUN_STATE_FORWARD) {
    expect(isExceptionState(state)).toBe(false);
  }
});

// ─── Test 9: Round-trip — RunStateSchema.parse works ───────

test('round-trip: RunStateSchema.parse works', () => {
  for (const state of RUN_STATE_FORWARD) {
    expect(RunStateSchema.parse(state)).toBe(state);
  }
  for (const state of RUN_STATE_EXCEPTION) {
    expect(RunStateSchema.parse(state)).toBe(state);
  }
});
