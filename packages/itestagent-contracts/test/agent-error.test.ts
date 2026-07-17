import { expect, test } from 'bun:test';
import { AgentErrorCodeSchema, AgentErrorSchema, parseAgentError } from '../src/agent-error.js';

test('AgentErrorCodeSchema parses all 14 valid codes', () => {
  const validCodes = [
    'blocked.security',
    'blocked.setup',
    'blocked.no_device_available',
    'blocked.cross_target_fallback',
    'blocked.target_unsupported',
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

// ─── ADR-011: new error codes ─────────────────────────────────

test('AgentErrorCodeSchema accepts blocked.cross_target_fallback', () => {
  const result = AgentErrorSchema.parse({
    code: 'blocked.cross_target_fallback',
    message: 'Cross target kind fallback requires user confirmation',
  });
  expect(result.code).toBe('blocked.cross_target_fallback');
});

test('AgentErrorCodeSchema accepts blocked.target_unsupported', () => {
  const result = AgentErrorSchema.parse({
    code: 'blocked.target_unsupported',
    message: 'Backend appium does not support target kind simulator',
  });
  expect(result.code).toBe('blocked.target_unsupported');
});

test('AgentErrorCodeSchema accepts blocked.no_device_available (renamed from no_real_device)', () => {
  const result = AgentErrorSchema.parse({
    code: 'blocked.no_device_available',
    message: 'No device available for target kind physical',
  });
  expect(result.code).toBe('blocked.no_device_available');
});

test('AgentErrorCodeSchema rejects old blocked.no_real_device code', () => {
  expect(() => AgentErrorCodeSchema.parse('blocked.no_real_device')).toThrow();
});
