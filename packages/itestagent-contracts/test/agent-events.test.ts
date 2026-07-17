import { expect, test } from 'bun:test';
import {
  AgentEventSchema,
  AgentEventTypeSchema,
  ArtifactCreatedEventSchema,
  AssistantDeltaEventSchema,
  PermissionRequestedEventSchema,
  PermissionResolvedEventSchema,
  RunStateChangedEventSchema,
  SessionAbortedEventSchema,
  SessionErrorEventSchema,
  SessionIdleEventSchema,
  SessionStartedEventSchema,
  ToolCompletedEventSchema,
  ToolFailedEventSchema,
  ToolProgressEventSchema,
  ToolRequestedEventSchema,
  ToolStartedEventSchema,
  TurnCompletedEventSchema,
  TurnStartedEventSchema,
  isTerminalEvent,
} from '../src/agent-events.js';

// ─── Test 1: AgentEventTypeSchema contains all 16 event types ──

test('AgentEventTypeSchema contains all 16 event types', () => {
  const options = AgentEventTypeSchema.options as readonly string[];

  expect(options).toHaveLength(16);

  const expectedTypes = [
    'session.started',
    'turn.started',
    'assistant.delta',
    'tool.requested',
    'permission.requested',
    'permission.resolved',
    'tool.started',
    'tool.progress',
    'tool.completed',
    'tool.failed',
    'run.state.changed',
    'artifact.created',
    'turn.completed',
    'session.idle',
    'session.aborted',
    'session.error',
  ];

  for (const t of expectedTypes) {
    expect(options).toContain(t);
  }
});

// ─── Test 2: SessionStartedEventSchema parses valid event ─────

test('SessionStartedEventSchema parses valid event', () => {
  const result = SessionStartedEventSchema.parse({
    type: 'session.started',
    sessionId: 'ses_001',
    workspace: '/Users/dev/my-ios-app',
    startedAt: '2026-07-17T00:00:00Z',
  });

  expect(result.sessionId).toBe('ses_001');
  expect(result.workspace).toBe('/Users/dev/my-ios-app');
  expect(result.startedAt).toBe('2026-07-17T00:00:00Z');
});

// ─── Test 3: TurnStartedEventSchema parses with optional runId ──

test('TurnStartedEventSchema parses with optional runId', () => {
  // Without runId
  const without = TurnStartedEventSchema.parse({
    type: 'turn.started',
    turnId: 'turn_001',
  });
  expect(without.turnId).toBe('turn_001');
  expect(without.runId).toBeUndefined();

  // With runId
  const withRun = TurnStartedEventSchema.parse({
    type: 'turn.started',
    turnId: 'turn_002',
    runId: 'run_001',
  });
  expect(withRun.turnId).toBe('turn_002');
  expect(withRun.runId).toBe('run_001');
});

// ─── Test 4: AssistantDeltaEventSchema parses delta payload ────

test('AssistantDeltaEventSchema parses delta payload', () => {
  const result = AssistantDeltaEventSchema.parse({
    type: 'assistant.delta',
    delta: 'OK, I will now tap the login button.',
    turnId: 'turn_001',
  });

  expect(result.delta).toBe('OK, I will now tap the login button.');
  expect(result.turnId).toBe('turn_001');
});

// ─── Test 5: ToolRequestedEventSchema parses with arguments object ──

test('ToolRequestedEventSchema parses with arguments object', () => {
  const result = ToolRequestedEventSchema.parse({
    type: 'tool.requested',
    callId: 'call_001',
    name: 'tap',
    arguments: { x: '0.5', y: '0.3' },
  });

  expect(result.callId).toBe('call_001');
  expect(result.name).toBe('tap');
  expect(result.arguments).toEqual({ x: '0.5', y: '0.3' });
});

// ─── Test 6: PermissionRequestedEventSchema parses valid request ──

test('PermissionRequestedEventSchema parses valid permission request', () => {
  const result = PermissionRequestedEventSchema.parse({
    type: 'permission.requested',
    callId: 'call_001',
    action: 'clear_app_data',
    resource: 'com.example.app',
  });

  expect(result.callId).toBe('call_001');
  expect(result.action).toBe('clear_app_data');
  expect(result.resource).toBe('com.example.app');
});

// ─── Test 7: PermissionResolvedEventSchema parses with allow/deny ──

test('PermissionResolvedEventSchema parses with allow/deny effect', () => {
  const allowed = PermissionResolvedEventSchema.parse({
    type: 'permission.resolved',
    callId: 'call_001',
    effect: 'allow',
  });
  expect(allowed.effect).toBe('allow');

  const denied = PermissionResolvedEventSchema.parse({
    type: 'permission.resolved',
    callId: 'call_002',
    effect: 'deny',
  });
  expect(denied.effect).toBe('deny');

  const asked = PermissionResolvedEventSchema.parse({
    type: 'permission.resolved',
    callId: 'call_003',
    effect: 'ask',
  });
  expect(asked.effect).toBe('ask');
});

// ─── Test 8: ToolStartedEventSchema parses valid tool start ────

test('ToolStartedEventSchema parses valid tool start', () => {
  const result = ToolStartedEventSchema.parse({
    type: 'tool.started',
    callId: 'call_001',
    name: 'screenshot',
    backend: 'device-appium',
  });

  expect(result.callId).toBe('call_001');
  expect(result.name).toBe('screenshot');
  expect(result.backend).toBe('device-appium');
});

// ─── Test 9: ToolProgressEventSchema parses optional percent ────

test('ToolProgressEventSchema parses with optional percent', () => {
  // With percent
  const withPercent = ToolProgressEventSchema.parse({
    type: 'tool.progress',
    callId: 'call_001',
    message: 'Installing app...',
    percent: 45,
  });
  expect(withPercent.message).toBe('Installing app...');
  expect(withPercent.percent).toBe(45);

  // Without percent
  const withoutPercent = ToolProgressEventSchema.parse({
    type: 'tool.progress',
    callId: 'call_002',
    message: 'Waiting for device...',
  });
  expect(withoutPercent.message).toBe('Waiting for device...');
  expect(withoutPercent.percent).toBeUndefined();
});

// ─── Test 10: ToolCompletedEventSchema parses with ToolResult (ok status) ──

test('ToolCompletedEventSchema parses with ToolResult (ok status)', () => {
  const result = ToolCompletedEventSchema.parse({
    type: 'tool.completed',
    callId: 'call_001',
    result: {
      callId: 'call_001',
      status: 'ok',
      output: { message: 'Screenshot captured' },
    },
  });

  expect(result.callId).toBe('call_001');
  expect(result.result.status).toBe('ok');
  expect((result.result.output as Record<string, unknown>).message).toBe('Screenshot captured');
});

// ─── Test 11: ToolCompletedEventSchema parses with ToolResult (error status) ──

test('ToolCompletedEventSchema parses with ToolResult (error status)', () => {
  const result = ToolCompletedEventSchema.parse({
    type: 'tool.completed',
    callId: 'call_002',
    result: {
      callId: 'call_002',
      status: 'error',
      output: { error: 'Connection refused' },
    },
  });

  expect(result.callId).toBe('call_002');
  expect(result.result.status).toBe('error');
  expect((result.result.output as Record<string, unknown>).error).toBe('Connection refused');
});

// ─── Test 12: ToolFailedEventSchema parses with AgentError ───────

test('ToolFailedEventSchema parses with AgentError', () => {
  const result = ToolFailedEventSchema.parse({
    type: 'tool.failed',
    callId: 'call_001',
    error: {
      code: 'backend.error',
      message: 'WDA connection timeout',
      details: 'No response within 30s',
    },
  });

  expect(result.callId).toBe('call_001');
  expect(result.error.code).toBe('backend.error');
  expect(result.error.message).toBe('WDA connection timeout');
  expect(result.error.details).toBe('No response within 30s');
});

// ─── Test 13: RunStateChangedEventSchema parses state change ──────

test('RunStateChangedEventSchema parses state change', () => {
  const result = RunStateChangedEventSchema.parse({
    type: 'run.state.changed',
    runId: 'run_001',
    from: 'executing',
    to: 'collecting',
    reason: 'All steps completed',
  });

  expect(result.runId).toBe('run_001');
  expect(result.from).toBe('executing');
  expect(result.to).toBe('collecting');
  expect(result.reason).toBe('All steps completed');
});

// ─── Test 14: ArtifactCreatedEventSchema parses with ArtifactRef ──

test('ArtifactCreatedEventSchema parses with ArtifactRef', () => {
  const result = ArtifactCreatedEventSchema.parse({
    type: 'artifact.created',
    artifact: {
      id: 'art_001',
      type: 'screenshot',
      path: 'artifacts/screen_001.png',
      redactionStatus: 'safe',
    },
  });

  expect(result.artifact.id).toBe('art_001');
  expect(result.artifact.type).toBe('screenshot');
  expect(result.artifact.path).toBe('artifacts/screen_001.png');
  expect(result.artifact.redactionStatus).toBe('safe');
});

// ─── Test 15: TurnCompletedEventSchema parses with optional summary ──

test('TurnCompletedEventSchema parses with optional summary', () => {
  // With summary
  const withSummary = TurnCompletedEventSchema.parse({
    type: 'turn.completed',
    turnId: 'turn_001',
    summary: 'Tapped login button, navigated to home screen',
  });
  expect(withSummary.turnId).toBe('turn_001');
  expect(withSummary.summary).toBe('Tapped login button, navigated to home screen');

  // Without summary
  const withoutSummary = TurnCompletedEventSchema.parse({
    type: 'turn.completed',
    turnId: 'turn_002',
  });
  expect(withoutSummary.turnId).toBe('turn_002');
  expect(withoutSummary.summary).toBeUndefined();
});

// ─── Test 16: SessionIdle/Aborted/Error schemas parse correctly ──

test('SessionIdle/Aborted/Error event schemas parse correctly', () => {
  const idleResult = SessionIdleEventSchema.parse({
    type: 'session.idle',
    sessionId: 'ses_001',
  });
  expect(idleResult.sessionId).toBe('ses_001');

  const abortedResult = SessionAbortedEventSchema.parse({
    type: 'session.aborted',
    sessionId: 'ses_001',
    reason: 'User pressed Ctrl+C',
  });
  expect(abortedResult.sessionId).toBe('ses_001');
  expect(abortedResult.reason).toBe('User pressed Ctrl+C');

  const errorResult = SessionErrorEventSchema.parse({
    type: 'session.error',
    sessionId: 'ses_001',
    error: {
      code: 'blocked.no_device_available',
      message: 'No iPhone connected',
    },
  });
  expect(errorResult.sessionId).toBe('ses_001');
  expect(errorResult.error.code).toBe('blocked.no_device_available');
});

// ─── Test 17: AgentEventSchema routes different event types ────────

test('AgentEventSchema discriminated union routes different event types correctly', () => {
  const sessionStarted = AgentEventSchema.parse({
    type: 'session.started',
    sessionId: 'ses_001',
    workspace: '/Users/dev/app',
    startedAt: '2026-07-17T00:00:00Z',
  });
  expect(sessionStarted.type).toBe('session.started');
  expect('workspace' in sessionStarted).toBe(true);

  const turnStarted = AgentEventSchema.parse({
    type: 'turn.started',
    turnId: 'turn_001',
  });
  expect(turnStarted.type).toBe('turn.started');
  expect('turnId' in turnStarted).toBe(true);

  const assistantDelta = AgentEventSchema.parse({
    type: 'assistant.delta',
    delta: 'Hello',
    turnId: 'turn_001',
  });
  expect(assistantDelta.type).toBe('assistant.delta');

  const toolCompleted = AgentEventSchema.parse({
    type: 'tool.completed',
    callId: 'call_001',
    result: {
      callId: 'call_001',
      status: 'ok',
      output: {},
    },
  });
  expect(toolCompleted.type).toBe('tool.completed');
  if (toolCompleted.type === 'tool.completed') {
    expect(toolCompleted.result.status).toBe('ok');
  }

  const runStateChanged = AgentEventSchema.parse({
    type: 'run.state.changed',
    runId: 'run_001',
    from: 'created',
    to: 'planning',
  });
  expect(runStateChanged.type).toBe('run.state.changed');
  if (runStateChanged.type === 'run.state.changed') {
    expect(runStateChanged.from).toBe('created');
    expect(runStateChanged.to).toBe('planning');
  }

  const sessionError = AgentEventSchema.parse({
    type: 'session.error',
    sessionId: 'ses_001',
    error: {
      code: 'blocked.security',
      message: 'Access denied',
    },
  });
  expect(sessionError.type).toBe('session.error');
  if (sessionError.type === 'session.error') {
    expect(sessionError.error.code).toBe('blocked.security');
  }

  // Invalid event type should throw
  expect(() => AgentEventSchema.parse({ type: 'unknown.event' })).toThrow();
});

// ─── Test 18: isTerminalEvent returns true for idle/aborted/error ──

test('isTerminalEvent returns true for idle/aborted/error', () => {
  const idle = SessionIdleEventSchema.parse({
    type: 'session.idle',
    sessionId: 'ses_001',
  });
  const aborted = SessionAbortedEventSchema.parse({
    type: 'session.aborted',
    sessionId: 'ses_001',
    reason: 'Timeout',
  });
  const error = SessionErrorEventSchema.parse({
    type: 'session.error',
    sessionId: 'ses_001',
    error: { code: 'backend.error', message: 'Fail' },
  });

  expect(isTerminalEvent(idle)).toBe(true);
  expect(isTerminalEvent(aborted)).toBe(true);
  expect(isTerminalEvent(error)).toBe(true);
});

// ─── Test 19: isTerminalEvent returns false for non-terminal events ──

test('isTerminalEvent returns false for non-terminal events', () => {
  const sessionStarted = SessionStartedEventSchema.parse({
    type: 'session.started',
    sessionId: 'ses_001',
    workspace: '/tmp',
    startedAt: '2026-07-17T00:00:00Z',
  });
  const turnStarted = TurnStartedEventSchema.parse({
    type: 'turn.started',
    turnId: 'turn_001',
  });
  const toolCompleted = ToolCompletedEventSchema.parse({
    type: 'tool.completed',
    callId: 'call_001',
    result: { callId: 'call_001', status: 'ok', output: {} },
  });
  const turnCompleted = TurnCompletedEventSchema.parse({
    type: 'turn.completed',
    turnId: 'turn_001',
  });

  expect(isTerminalEvent(sessionStarted)).toBe(false);
  expect(isTerminalEvent(turnStarted)).toBe(false);
  expect(isTerminalEvent(toolCompleted)).toBe(false);
  expect(isTerminalEvent(turnCompleted)).toBe(false);
});
