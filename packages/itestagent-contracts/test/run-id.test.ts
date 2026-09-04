import { describe, expect, test } from 'bun:test';
import { RunIdSchema, isSafeRunId } from '../src/run-id.js';

describe('canonical run ID', () => {
  test('accepts one through 128 safe characters', () => {
    expect(RunIdSchema.parse('a')).toBe('a');
    expect(RunIdSchema.parse('a'.repeat(128))).toHaveLength(128);
    expect(isSafeRunId('run-safe_1.0')).toBe(true);
  });

  test('rejects unsafe or oversized identifiers', () => {
    expect(RunIdSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(isSafeRunId('../outside')).toBe(false);
    expect(isSafeRunId('a/b')).toBe(false);
  });
});
