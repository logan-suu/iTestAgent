import { expect, test } from 'bun:test';
import { AgentErrorCodeSchema, AgentErrorSchema, parseAgentError } from '../src/agent-error.js';

test('AgentErrorCodeSchema parses all 12 valid codes', () => {
  const validCodes = [
    'blocked.security',
    'blocked.setup',
    'blocked.no_real_device',
    'blocked.privacy',
    'blocked.safety',
    'capability.missing',
    'backend.error',
    'artifact.error',
    'app_state.unexpected',
    'timeout.flaky',
    'not_exportable',
    'inconclusive',
  ] as const;
  for (const code of validCodes) {
    expect(AgentErrorCodeSchema.parse(code)).toBe(code);
  }
});

test('AgentErrorCodeSchema rejects invalid code', () => {
  expect(() => AgentErrorCodeSchema.parse('invalid.code')).toThrow();
  expect(() => AgentErrorCodeSchema.parse('UNKNOWN')).toThrow();
  expect(() => AgentErrorCodeSchema.parse(42)).toThrow();
});

test('AgentErrorSchema parses error with minimum fields', () => {
  const result = AgentErrorSchema.parse({
    code: 'timeout.flaky',
    message: 'timed out',
  });
  expect(result.code).toBe('timeout.flaky');
  expect(result.message).toBe('timed out');
  expect(result.details).toBeUndefined();
  expect(result.cause).toBeUndefined();
});

test('AgentErrorSchema parses error with optional details and cause', () => {
  const cause = new Error('root');
  const result = AgentErrorSchema.parse({
    code: 'backend.error',
    message: 'Appium session failed',
    details: 'Session creation timeout after 30s',
    cause,
  });
  expect(result.code).toBe('backend.error');
  expect(result.message).toBe('Appium session failed');
  expect(result.details).toBe('Session creation timeout after 30s');
  expect(result.cause).toBe(cause);
});

test('AgentErrorSchema rejects missing code', () => {
  expect(() => AgentErrorSchema.parse({ message: 'no code' })).toThrow();
});

test('Round-trip: parse → JSON.stringify → parse', () => {
  const original = {
    code: 'blocked.setup' as const,
    message: 'Xcode not installed',
    details: 'xcode-select -p returned empty',
  };
  const parsed = parseAgentError(original);
  expect(parsed.code).toBe('blocked.setup');

  const serialized = JSON.stringify(parsed);
  const reparsed = parseAgentError(JSON.parse(serialized));
  expect(reparsed.code).toBe(original.code);
  expect(reparsed.message).toBe(original.message);
  expect(reparsed.details).toBe(original.details);
});
