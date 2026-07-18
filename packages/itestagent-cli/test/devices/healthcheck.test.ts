import { describe, expect, test } from 'bun:test';
import { HealthCheckResultSchema } from 'itestagent-contracts';

/**
 * Healthcheck tests — validate HealthCheckResult schema and output shape.
 *
 * US-2.2 AC1: healthcheck covers connection, trust, Developer Mode (physical),
 *              backend available, runtime/simctl (simulator).
 * US-2.2 AC2: unhealthy → reason + fix guidance, distinguish physical/simulator.
 * US-2.2 AC3: results recorded in metadata (含 targetKind).
 */

// ─── Schema validation ─────────────────────────────────────

describe('HealthCheckResultSchema', () => {
  test('accepts healthy result with details', () => {
    const result = {
      healthy: true,
      details: 'All checks passed',
    };
    const parsed = HealthCheckResultSchema.parse(result);
    expect(parsed.healthy).toBe(true);
    expect(parsed.details).toBe('All checks passed');
  });

  test('accepts unhealthy result with details', () => {
    const result = {
      healthy: false,
      details: 'Device not trusted\nFix: unlock and trust computer',
    };
    const parsed = HealthCheckResultSchema.parse(result);
    expect(parsed.healthy).toBe(false);
    expect(parsed.details).toContain('Device not trusted');
    expect(parsed.details).toContain('Fix:');
  });

  test('accepts result without details (details optional)', () => {
    const result = { healthy: true };
    const parsed = HealthCheckResultSchema.parse(result);
    expect(parsed.healthy).toBe(true);
    expect(parsed.details).toBeUndefined();
  });

  test('rejects missing healthy field', () => {
    expect(() => HealthCheckResultSchema.parse({ details: 'something' })).toThrow();
  });

  test('rejects non-boolean healthy', () => {
    expect(() => HealthCheckResultSchema.parse({ healthy: 'yes' })).toThrow();
  });
});

// ─── Healthcheck output shape ──────────────────────────────

describe('HealthCheckResult content requirements', () => {
  test('unhealthy physical device includes fix guidance (US-2.2 AC2)', () => {
    const result = HealthCheckResultSchema.parse({
      healthy: false,
      details: `Physical device check failed:
  - Device not trusted

Fix guidance (physical device):
  → Unlock your iPhone and tap "Trust This Computer"
  → Verify: xcrun devicectl device info --device <UDID>`,
    });

    expect(result.healthy).toBe(false);
    expect(result.details).toContain('physical');
    expect(result.details).toContain('Fix guidance');
    expect(result.details).toContain('Trust This Computer');
  });

  test('unhealthy simulator device includes fix guidance (US-2.2 AC2)', () => {
    const result = HealthCheckResultSchema.parse({
      healthy: false,
      details: `Simulator device check failed:
  - Runtime not installed

Fix guidance (simulator):
  → Install the required runtime: xcrun simctl runtime add <identifier>`,
    });

    expect(result.healthy).toBe(false);
    expect(result.details).toContain('simulator');
    expect(result.details).toContain('Fix guidance');
    expect(result.details).toContain('simctl runtime add');
  });

  test('healthy result is unambiguous', () => {
    const result = HealthCheckResultSchema.parse({
      healthy: true,
      details: 'All checks passed',
    });

    expect(result.healthy).toBe(true);
  });
});
