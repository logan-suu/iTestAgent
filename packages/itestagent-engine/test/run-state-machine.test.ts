import { describe, expect, test } from 'bun:test';
import type { RunState, RunStateChangedEvent } from 'itestagent-contracts';
import { RUN_STATE_EXCEPTION, RUN_STATE_FORWARD } from 'itestagent-contracts';
import { ErrorLevelSchema, RunStateMachine, classifyError } from '../src/run-state-machine.js';

// ─── Helper ────────────────────────────────────────────────

/** Create a fresh RunStateMachine that collects events into an array. */
function createMachine(): {
  machine: RunStateMachine;
  events: RunStateChangedEvent[];
} {
  const events: RunStateChangedEvent[] = [];
  const machine = new RunStateMachine({
    onEvent: (e) => events.push(e),
  });
  return { machine, events };
}

// ────────────────────────────────────────────────────────────
//  Error Classification (classifyError)
// ────────────────────────────────────────────────────────────

describe('classifyError', () => {
  test('classifies timeout as L1 transient', () => {
    expect(classifyError('operation timed out')).toBe('L1');
  });

  test('classifies element not found as L1 transient', () => {
    expect(classifyError('element not found on page')).toBe('L1');
    expect(classifyError('stale element reference')).toBe('L1');
  });

  test('classifies connection refused as L1 transient', () => {
    expect(classifyError('connection refused')).toBe('L1');
    expect(classifyError('connection reset by peer')).toBe('L1');
  });

  test('classifies file lock as L1 transient', () => {
    expect(classifyError('file is locked by another process')).toBe('L1');
  });

  test('classifies provisioning error as L2 needs-confirm', () => {
    expect(classifyError('provisioning profile expired')).toBe('L2');
    expect(classifyError('signing certificate is invalid')).toBe('L2');
  });

  test('classifies device disconnect as L2 needs-confirm', () => {
    expect(classifyError('device disconnected unexpectedly')).toBe('L2');
  });

  test('classifies WDA port conflict as L2 needs-confirm', () => {
    expect(classifyError('WDA port conflict detected')).toBe('L2');
  });

  test('classifies Xcode missing as L3 blocking', () => {
    expect(classifyError('Xcode not found')).toBe('L3');
    expect(classifyError('Xcode is not installed')).toBe('L3');
  });

  test('classifies build failure as L3 blocking', () => {
    expect(classifyError('build failed with exit code 1')).toBe('L3');
  });

  test('classifies Appium missing as L3 blocking', () => {
    expect(classifyError('Appium server not available')).toBe('L3');
  });

  test('classifies no matching backend as L3 blocking', () => {
    expect(classifyError('no matching backend found for target')).toBe('L3');
  });

  test('defaults unknown errors to L4 uncertain', () => {
    expect(classifyError('something unexpected happened')).toBe('L4');
  });

  test('uses error code hint for classification', () => {
    expect(classifyError('error', 'timeout.flaky')).toBe('L1');
    expect(classifyError('error', 'build_failed')).toBe('L3');
  });

  test('L3 patterns take priority over L1/L2', () => {
    // "Xcode not found: timeout" → L3, not L1
    expect(classifyError('Xcode not found: timeout')).toBe('L3');
  });
});

// ────────────────────────────────────────────────────────────
//  ErrorLevel Schema
// ────────────────────────────────────────────────────────────

describe('ErrorLevelSchema', () => {
  test('parses valid L1-L4 values', () => {
    expect(ErrorLevelSchema.parse('L1')).toBe('L1');
    expect(ErrorLevelSchema.parse('L2')).toBe('L2');
    expect(ErrorLevelSchema.parse('L3')).toBe('L3');
    expect(ErrorLevelSchema.parse('L4')).toBe('L4');
  });

  test('rejects invalid values', () => {
    expect(() => ErrorLevelSchema.parse('L0')).toThrow();
    expect(() => ErrorLevelSchema.parse('L5')).toThrow();
    expect(() => ErrorLevelSchema.parse('')).toThrow();
  });
});

// ────────────────────────────────────────────────────────────
//  RunStateMachine — Forward Transitions
// ────────────────────────────────────────────────────────────

describe('RunStateMachine forward transitions', () => {
  test('full forward chain: created → done (11 steps)', () => {
    const { machine, events } = createMachine();
    const runId = 'run-forward';

    let state: RunState = 'created';
    const forwardChain: RunState[] = [
      'created',
      'planning',
      'awaiting_confirm',
      'preparing_device',
      'building_installing',
      'executing',
      'collecting',
      'parsing',
      'explaining',
      'reported',
      'done',
    ];

    for (let i = 1; i < forwardChain.length; i++) {
      const from = forwardChain[i - 1] as RunState;
      const to = forwardChain[i] as RunState;
      state = machine.transition(runId, from, to);
      expect(state).toBe(to);
    }

    expect(state).toBe('done');
    expect(events).toHaveLength(10); // 10 transitions
  });

  test('each forward state → next is valid', () => {
    const { machine } = createMachine();

    for (let i = 0; i < RUN_STATE_FORWARD.length - 1; i++) {
      const from = RUN_STATE_FORWARD[i] as RunState;
      const to = RUN_STATE_FORWARD[i + 1] as RunState;
      const result = machine.transition(`run-${i}`, from, to);
      expect(result).toBe(to);
    }
  });

  test('events carry correct runId and state pair', () => {
    const { machine, events } = createMachine();
    machine.transition('my-run', 'created', 'planning');

    expect(events).toHaveLength(1);
    expect(events[0]?.runId).toBe('my-run');
    expect(events[0]?.from).toBe('created');
    expect(events[0]?.to).toBe('planning');
    expect(events[0]?.reason).toBeUndefined();
  });

  test('events carry reason when provided', () => {
    const { machine, events } = createMachine();
    machine.transition('r1', 'created', 'planning', 'AI started planning');

    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('AI started planning');
  });
});

// ────────────────────────────────────────────────────────────
//  RunStateMachine — Invalid Transition Rejection
// ────────────────────────────────────────────────────────────

describe('RunStateMachine invalid transition rejection', () => {
  test('rejects backward transition', () => {
    const { machine } = createMachine();
    expect(() => machine.transition('r1', 'planning', 'created')).toThrow('Invalid transition');
  });

  test('rejects skip-over transition', () => {
    const { machine } = createMachine();
    expect(() => machine.transition('r1', 'created', 'executing')).toThrow('Invalid transition');
  });

  test('rejects transition from done (terminal)', () => {
    const { machine } = createMachine();
    expect(() => machine.transition('r1', 'done', 'reported')).toThrow('terminal state');
  });

  test('rejects transition from exception state (except to done)', () => {
    const { machine } = createMachine();
    // failed is terminal; executing is not a valid target
    expect(() => machine.transition('r1', 'failed', 'executing')).toThrow('terminal');
  });

  test('does NOT emit events on invalid transition', () => {
    const { machine, events } = createMachine();
    try {
      machine.transition('r1', 'done', 'reported');
    } catch {
      // expected
    }
    expect(events).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────
//  RunStateMachine — Exception Transitions
// ────────────────────────────────────────────────────────────

describe('RunStateMachine exception transitions', () => {
  test('cancel: any forward state → cancelled', () => {
    const { machine } = createMachine();
    const nonTerminal = RUN_STATE_FORWARD.filter((s) => s !== 'done');

    for (const from of nonTerminal) {
      const result = machine.cancel(`run-${from}`, from);
      expect(result).toBe('cancelled');
    }
  });

  test('block: any forward state → blocked', () => {
    const { machine } = createMachine();
    const nonTerminal = RUN_STATE_FORWARD.filter((s) => s !== 'done');

    for (const from of nonTerminal) {
      const result = machine.block(`run-${from}`, from);
      expect(result).toBe('blocked');
    }
  });

  test('fail: any forward state → failed', () => {
    const { machine } = createMachine();
    const nonTerminal = RUN_STATE_FORWARD.filter((s) => s !== 'done');

    for (const from of nonTerminal) {
      const result = machine.fail(`run-${from}`, from);
      expect(result).toBe('failed');
    }
  });

  test('infraFail: any forward state → infra_failed', () => {
    const { machine } = createMachine();
    const nonTerminal = RUN_STATE_FORWARD.filter((s) => s !== 'done');

    for (const from of nonTerminal) {
      const result = machine.infraFail(`run-${from}`, from);
      expect(result).toBe('infra_failed');
    }
  });

  test('exception state → done is valid', () => {
    const { machine } = createMachine();

    for (const from of RUN_STATE_EXCEPTION) {
      const result = machine.transition(`run-${from}`, from, 'done');
      expect(result).toBe('done');
    }
  });

  test('cancel with reason is included in event', () => {
    const { machine, events } = createMachine();
    machine.cancel('r1', 'executing', 'user pressed Ctrl+C');

    expect(events).toHaveLength(1);
    expect(events[0]?.to).toBe('cancelled');
    expect(events[0]?.reason).toBe('user pressed Ctrl+C');
  });
});

// ────────────────────────────────────────────────────────────
//  RunStateMachine — Pause / Resume
// ────────────────────────────────────────────────────────────

describe('RunStateMachine pause and resume', () => {
  test('pause transitions to blocked and saves context', () => {
    const { machine } = createMachine();

    const result = machine.pause('r1', 'executing', 'device disconnected');
    expect(result).toBe('blocked');
    expect(machine.isPaused('r1')).toBe(true);

    const ctx = machine.getPauseContext('r1');
    expect(ctx).toBeDefined();
    expect(ctx?.prePauseState).toBe('executing');
    expect(ctx?.reason).toBe('device disconnected');
  });

  test('pause without reason defaults to "paused"', () => {
    const { machine } = createMachine();

    machine.pause('r1', 'collecting');
    const ctx = machine.getPauseContext('r1');
    expect(ctx?.reason).toBe('paused');
  });

  test('resume: blocked → awaiting_confirm', () => {
    const { machine } = createMachine();

    machine.pause('r1', 'executing');
    const result = machine.resume('r1');

    expect(result).toBe('awaiting_confirm');
    expect(machine.isPaused('r1')).toBe(false);
    expect(machine.getPauseContext('r1')).toBeUndefined();
  });

  test('resume emits event with reason "resumed"', () => {
    const { machine, events } = createMachine();

    machine.pause('r1', 'building_installing');
    const beforeCount = events.length;

    machine.resume('r1');
    const resumeEvent = events[events.length - 1] as RunStateChangedEvent;
    expect(resumeEvent.from).toBe('blocked');
    expect(resumeEvent.to).toBe('awaiting_confirm');
    expect(resumeEvent.reason).toBe('resumed');
  });

  test('resume fails if not paused', () => {
    const { machine } = createMachine();

    expect(() => machine.resume('r1')).toThrow('not paused');
  });

  test('resume fails after cleanup', () => {
    const { machine } = createMachine();

    machine.pause('r1', 'executing');
    machine.cleanup('r1');
    expect(machine.isPaused('r1')).toBe(false);
    expect(() => machine.resume('r1')).toThrow('not paused');
  });

  test('multiple runs are isolated', () => {
    const { machine } = createMachine();

    machine.pause('run-a', 'executing');
    machine.pause('run-b', 'collecting');

    expect(machine.isPaused('run-a')).toBe(true);
    expect(machine.isPaused('run-b')).toBe(true);
    expect(machine.getPauseContext('run-a')?.prePauseState).toBe('executing');
    expect(machine.getPauseContext('run-b')?.prePauseState).toBe('collecting');

    // Resume run-a only
    machine.resume('run-a');
    expect(machine.isPaused('run-a')).toBe(false);
    expect(machine.isPaused('run-b')).toBe(true);

    // Resume run-b
    machine.resume('run-b');
    expect(machine.isPaused('run-b')).toBe(false);
  });

  test('pause from any non-terminal forward state works', () => {
    const { machine } = createMachine();
    const nonTerminal = RUN_STATE_FORWARD.filter((s) => s !== 'done');

    for (const from of nonTerminal) {
      const runId = `run-pause-${from}`;
      const result = machine.pause(runId, from);
      expect(result).toBe('blocked');
      expect(machine.isPaused(runId)).toBe(true);
    }
  });

  test('full pause-resume-continue cycle', () => {
    const { machine } = createMachine();

    // Start run
    let state: RunState = 'created';
    state = machine.transition('r1', state, 'planning');
    state = machine.transition('r1', state, 'awaiting_confirm');

    // Pause during execution (simulating L2 error)
    state = machine.transition('r1', state, 'preparing_device');
    state = machine.pause('r1', state, 'WDA port conflict');

    expect(state).toBe('blocked');
    expect(machine.getPauseContext('r1')?.prePauseState).toBe('preparing_device');

    // User fixed the issue, resume
    state = machine.resume('r1');
    expect(state).toBe('awaiting_confirm');

    // User confirms, continue
    state = machine.transition('r1', state, 'preparing_device');
    state = machine.transition('r1', state, 'building_installing');
    state = machine.transition('r1', state, 'executing');
    expect(state).toBe('executing');
  });

  test('block (not pause) also tracks context', () => {
    const { machine } = createMachine();

    machine.block('r1', 'executing', 'blocked by security policy');
    expect(machine.isPaused('r1')).toBe(true);
    expect(machine.getPauseContext('r1')?.reason).toBe('blocked by security policy');
  });

  test('blocked → done clears pause context', () => {
    const { machine } = createMachine();

    machine.pause('r1', 'executing', 'paused');
    expect(machine.isPaused('r1')).toBe(true);

    // blocked → done is valid (contract), should clear context
    machine.transition('r1', 'blocked', 'done');
    expect(machine.isPaused('r1')).toBe(false);
    expect(machine.getPauseContext('r1')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
//  RunStateMachine — Lifecycle
// ────────────────────────────────────────────────────────────

describe('RunStateMachine lifecycle', () => {
  test('start returns "created"', () => {
    const { machine } = createMachine();
    expect(machine.start('r1')).toBe('created');
  });

  test('cleanup is idempotent', () => {
    const { machine } = createMachine();

    machine.pause('r1', 'executing');
    expect(machine.isPaused('r1')).toBe(true);

    machine.cleanup('r1');
    expect(machine.isPaused('r1')).toBe(false);

    // Cleanup again — no error
    machine.cleanup('r1');
    expect(machine.isPaused('r1')).toBe(false);
  });

  test('cleanup does not affect other runs', () => {
    const { machine } = createMachine();

    machine.pause('r1', 'executing');
    machine.pause('r2', 'collecting');
    machine.cleanup('r1');

    expect(machine.isPaused('r1')).toBe(false);
    expect(machine.isPaused('r2')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
//  RunStateMachine — No onEvent (graceful)
// ────────────────────────────────────────────────────────────

describe('RunStateMachine without onEvent', () => {
  test('transitions work without event handler', () => {
    const machine = new RunStateMachine();
    const result = machine.transition('r1', 'created', 'planning');
    expect(result).toBe('planning');
  });

  test('pause/resume works without event handler', () => {
    const machine = new RunStateMachine();
    machine.pause('r1', 'executing');
    expect(machine.isPaused('r1')).toBe(true);
    expect(machine.resume('r1')).toBe('awaiting_confirm');
  });
});
