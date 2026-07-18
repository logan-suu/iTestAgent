import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentEvent, AgentTurnInput, ToolCall, ToolResult } from 'itestagent-contracts';
import { MockAgentRuntime } from '../src/mock-agent-runtime.js';

// ─── Fixtures ────────────────────────────────────────────────

const TURN_INPUT: AgentTurnInput = {
  messages: [{ role: 'user', content: 'test' }],
};

const TOOL_CALL: ToolCall = {
  id: 'call_1',
  name: 'tap',
  arguments: { x: '0.5', y: '0.5' },
};

const TOOL_RESULT: ToolResult = {
  callId: 'call_1',
  status: 'ok',
  output: { success: true },
};

const SAMPLE_EVENTS: AgentEvent[] = [
  {
    type: 'session.started',
    sessionId: 'ses_test',
    workspace: '/tmp',
    startedAt: new Date().toISOString(),
  },
  {
    type: 'turn.started',
    turnId: 'turn_1',
    runId: 'run_1',
  },
  {
    type: 'assistant.delta',
    delta: 'Hello',
    turnId: 'turn_1',
  },
  {
    type: 'tool.requested',
    callId: 'call_1',
    name: 'tap',
    arguments: { x: '0.5', y: '0.5' },
  },
  {
    type: 'tool.completed',
    callId: 'call_1',
    result: TOOL_RESULT,
  },
  {
    type: 'turn.completed',
    turnId: 'turn_1',
    summary: 'done',
  },
  {
    type: 'session.idle',
    sessionId: 'ses_test',
  },
];

// ─── streamTurn: basic event sequence ────────────────────────

describe('MockAgentRuntime', () => {
  describe('streamTurn', () => {
    test('yields preset event sequence in order', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setEventSequence(SAMPLE_EVENTS);

      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        events.push(event);
      }

      expect(events).toHaveLength(SAMPLE_EVENTS.length);
      for (let i = 0; i < SAMPLE_EVENTS.length; i++) {
        expect(events[i]).toEqual(SAMPLE_EVENTS[i]);
      }
    });

    test('returns empty iterable when no events are configured', async () => {
      const runtime = new MockAgentRuntime();

      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        events.push(event);
      }

      expect(events).toHaveLength(0);
    });

    test('can be called multiple times with same sequence', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setEventSequence(SAMPLE_EVENTS);

      const events1: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        events1.push(event);
      }

      const events2: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        events2.push(event);
      }

      expect(events1).toHaveLength(SAMPLE_EVENTS.length);
      expect(events2).toHaveLength(SAMPLE_EVENTS.length);
    });

    test('supports inter-event delay via delayMs config', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setEventSequence([
        {
          type: 'session.started',
          sessionId: 'ses_d',
          workspace: '/tmp',
          startedAt: new Date().toISOString(),
        },
        {
          type: 'session.idle',
          sessionId: 'ses_d',
        },
      ]);

      runtime.setConfig({ delayMs: 50 });

      const start = Date.now();
      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        events.push(event);
      }
      const elapsed = Date.now() - start;

      expect(events).toHaveLength(2);
      // 2 events, each with 50ms delay → at least 50ms total (second event delayed)
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    test('respects maxSteps from input to limit events', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setEventSequence(SAMPLE_EVENTS); // 7 events

      const input: AgentTurnInput = { messages: [], maxSteps: 3 };
      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(input)) {
        events.push(event);
      }

      expect(events.length).toBeLessThanOrEqual(3);
    });

    test('uses default maxSteps when input has no maxSteps', async () => {
      const runtime = new MockAgentRuntime();
      // 20 events — more than default maxSteps (10)
      const longEvents: AgentEvent[] = Array.from({ length: 20 }, (_, i) => ({
        type: 'assistant.delta' as const,
        delta: `msg_${i}`,
        turnId: 'turn_1',
      }));
      runtime.setEventSequence(longEvents);

      const input: AgentTurnInput = { messages: [] };
      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(input)) {
        events.push(event);
      }

      expect(events.length).toBeLessThanOrEqual(10);
    });
  });

  // ─── streamTurn: abort ─────────────────────────────────────

  describe('abort', () => {
    test('abort stops streamTurn mid-sequence', async () => {
      const runtime = new MockAgentRuntime();

      const events: AgentEvent[] = Array.from({ length: 100 }, (_, i) => ({
        type: 'assistant.delta' as const,
        delta: `msg_${i}`,
        turnId: 'turn_1',
      }));
      runtime.setEventSequence(events);
      runtime.setConfig({ delayMs: 5, defaultMaxSteps: 100 });

      // Abort after a few events via setTimeout.
      setTimeout(() => runtime.abort('test abort'), 15);

      const received: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        received.push(event);
      }

      // Should have received fewer than the full 100 events.
      expect(received.length).toBeLessThan(100);
      expect(runtime.isAborted()).toBe(true);
      expect(runtime.getAbortedReason()).toBe('test abort');
    });

    test('abort is idempotent', async () => {
      const runtime = new MockAgentRuntime();

      await runtime.abort('first');
      await runtime.abort('second');

      // Reason should be from the first abort.
      expect(runtime.getAbortedReason()).toBe('first');
    });

    test('abort before streamTurn results in empty iterable', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setEventSequence(SAMPLE_EVENTS);

      await runtime.abort('early');

      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        events.push(event);
      }

      expect(events).toHaveLength(0);
      expect(runtime.isAborted()).toBe(true);
    });

    test('resetAbort clears abort state', async () => {
      const runtime = new MockAgentRuntime();
      await runtime.abort('test');
      expect(runtime.isAborted()).toBe(true);

      runtime.resetAbort();
      expect(runtime.isAborted()).toBe(false);
      expect(runtime.getAbortedReason()).toBeNull();
    });
  });

  // ─── executeToolCall ───────────────────────────────────────

  describe('executeToolCall', () => {
    test('returns preset tool result for matching callId', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setToolResults(new Map([['call_1', TOOL_RESULT]]));

      const result = await runtime.executeToolCall(TOOL_CALL);
      expect(result).toEqual(TOOL_RESULT);
    });

    test('returns error result for unknown callId', async () => {
      const runtime = new MockAgentRuntime();

      const result = await runtime.executeToolCall(TOOL_CALL);
      expect(result.status).toBe('error');
      expect(result.callId).toBe('call_1');
    });

    test('respects preset tool result for specific call', async () => {
      const runtime = new MockAgentRuntime();
      const customResult: ToolResult = {
        callId: 'call_x',
        status: 'ok',
        output: { custom: true },
      };
      runtime.setToolResults(
        new Map([
          ['call_1', TOOL_RESULT],
          ['call_x', customResult],
        ]),
      );

      const r1 = await runtime.executeToolCall(TOOL_CALL);
      expect(r1).toEqual(TOOL_RESULT);

      const r2 = await runtime.executeToolCall({ id: 'call_x', name: 'screenshot', arguments: {} });
      expect(r2).toEqual(customResult);
    });

    test('tool call is recorded in history', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setToolResults(new Map([['call_1', TOOL_RESULT]]));

      await runtime.executeToolCall(TOOL_CALL);

      const history = runtime.getHistory();
      expect(history.toolCalls).toHaveLength(1);
      expect(history.toolCalls[0]).toEqual(TOOL_CALL);
    });
  });

  // ─── History tracking ──────────────────────────────────────

  describe('getHistory', () => {
    test('records events from streamTurn calls', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setEventSequence(SAMPLE_EVENTS);

      for await (const _event of runtime.streamTurn(TURN_INPUT)) {
        // consume
      }

      const history = runtime.getHistory();
      expect(history.events).toHaveLength(SAMPLE_EVENTS.length);
      expect(history.events[0]?.type).toBe('session.started');
    });

    test('accumulates events across multiple streamTurn calls', async () => {
      const runtime = new MockAgentRuntime();
      const events1: AgentEvent[] = [
        {
          type: 'session.started',
          sessionId: 's1',
          workspace: '/tmp',
          startedAt: new Date().toISOString(),
        },
        {
          type: 'session.idle',
          sessionId: 's1',
        },
      ];
      const events2: AgentEvent[] = [
        {
          type: 'session.started',
          sessionId: 's2',
          workspace: '/tmp',
          startedAt: new Date().toISOString(),
        },
        {
          type: 'session.idle',
          sessionId: 's2',
        },
      ];

      runtime.setEventSequence(events1);
      for await (const _event of runtime.streamTurn(TURN_INPUT)) {
        // consume
      }

      runtime.setEventSequence(events2);
      for await (const _event of runtime.streamTurn(TURN_INPUT)) {
        // consume
      }

      const history = runtime.getHistory();
      expect(history.events).toHaveLength(4);
    });

    test('getHistory returns empty arrays before any calls', () => {
      const runtime = new MockAgentRuntime();
      const history = runtime.getHistory();
      expect(history.events).toEqual([]);
      expect(history.toolCalls).toEqual([]);
    });

    test('clearHistory resets recorded events and tool calls', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setEventSequence(SAMPLE_EVENTS);
      runtime.setToolResults(new Map([['call_1', TOOL_RESULT]]));

      for await (const _event of runtime.streamTurn(TURN_INPUT)) {
        // consume
      }
      await runtime.executeToolCall(TOOL_CALL);

      runtime.clearHistory();

      const history = runtime.getHistory();
      expect(history.events).toEqual([]);
      expect(history.toolCalls).toEqual([]);
    });
  });

  // ─── Interface compliance ──────────────────────────────────

  describe('interface compliance', () => {
    test('implements AgentRuntime.streamTurn returning AsyncIterable', () => {
      const runtime = new MockAgentRuntime();
      const iterable = runtime.streamTurn(TURN_INPUT);
      expect(iterable[Symbol.asyncIterator]).toBeDefined();
    });

    test('implements AgentRuntime.executeToolCall returning Promise<ToolResult>', async () => {
      const runtime = new MockAgentRuntime();
      const result = await runtime.executeToolCall(TOOL_CALL);
      expect(result).toHaveProperty('callId');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('output');
    });

    test('implements AgentRuntime.abort returning Promise<void>', async () => {
      const runtime = new MockAgentRuntime();
      await expect(runtime.abort('test')).resolves.toBeUndefined();
    });

    test('setConfig with zero delayMs yields events without pause', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setConfig({ delayMs: 0 });
      runtime.setEventSequence(SAMPLE_EVENTS);

      const start = Date.now();
      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        events.push(event);
      }
      const elapsed = Date.now() - start;

      expect(events).toHaveLength(SAMPLE_EVENTS.length);
      // With delayMs=0, events should be yielded quickly (< 50ms for 7 events).
      expect(elapsed).toBeLessThan(50);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────

  describe('edge cases', () => {
    test('setEventSequence overrides previous sequence', async () => {
      const runtime = new MockAgentRuntime();
      const firstSeq: AgentEvent[] = [
        {
          type: 'session.started',
          sessionId: 'a',
          workspace: '/tmp',
          startedAt: new Date().toISOString(),
        },
      ];
      const secondSeq: AgentEvent[] = [
        {
          type: 'session.started',
          sessionId: 'b',
          workspace: '/tmp',
          startedAt: new Date().toISOString(),
        },
      ];

      runtime.setEventSequence(firstSeq);
      runtime.setEventSequence(secondSeq);

      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(TURN_INPUT)) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect((events[0] as { sessionId: string }).sessionId).toBe('b');
    });

    test('maxSteps 0 returns empty iterable', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setEventSequence(SAMPLE_EVENTS);

      const input: AgentTurnInput = { messages: [], maxSteps: 0 };
      const events: AgentEvent[] = [];
      for await (const event of runtime.streamTurn(input)) {
        events.push(event);
      }

      expect(events).toHaveLength(0);
    });

    test('tool call history is independent of event history', async () => {
      const runtime = new MockAgentRuntime();
      runtime.setToolResults(new Map([['call_1', TOOL_RESULT]]));

      await runtime.executeToolCall(TOOL_CALL);

      const history = runtime.getHistory();
      expect(history.toolCalls).toHaveLength(1);
      expect(history.events).toHaveLength(0); // No streamTurn called.
    });
  });
});
