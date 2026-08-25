import { expect, test } from 'bun:test';
import { LaunchAppInputSchema } from '../src/device-action-inputs.js';
import { LaunchAppInputSchema as FromDeviceTypes } from '../src/device-types.js';
import { LaunchAppInputSchema as FromIndex } from '../src/index.js';

/**
 * B01 thorough validation of LaunchAppInputSchema.
 *
 * The schema lives in src/device-action-inputs.ts after the device-core
 * split; src/device-types.ts and the barrel re-export the SAME zod object
 * (identity asserted below), so all historical import paths keep working.
 */

// ─── Required fields ─────────────────────────────────────────

test('LaunchAppInputSchema parses a valid minimal input', () => {
  const parsed = LaunchAppInputSchema.parse({
    deviceId: '00008110-001234567890001A',
    bundleId: 'com.example.app',
  });
  expect(parsed.deviceId).toBe('00008110-001234567890001A');
  expect(parsed.bundleId).toBe('com.example.app');
});

test('LaunchAppInputSchema requires deviceId', () => {
  expect(() => LaunchAppInputSchema.parse({ bundleId: 'com.example.app' })).toThrow();
});

test('LaunchAppInputSchema requires bundleId', () => {
  expect(() => LaunchAppInputSchema.parse({ deviceId: 'device-1' })).toThrow();
});

test('LaunchAppInputSchema rejects an empty object', () => {
  expect(() => LaunchAppInputSchema.parse({})).toThrow();
});

// ─── Field types ─────────────────────────────────────────────

test('LaunchAppInputSchema rejects non-string deviceId', () => {
  expect(() =>
    LaunchAppInputSchema.parse({ deviceId: 12345, bundleId: 'com.example.app' }),
  ).toThrow();
});

test('LaunchAppInputSchema rejects non-string bundleId', () => {
  expect(() => LaunchAppInputSchema.parse({ deviceId: 'device-1', bundleId: null })).toThrow();
});

test('LaunchAppInputSchema rejects array input', () => {
  expect(() => LaunchAppInputSchema.parse(['device-1', 'com.example.app'])).toThrow();
});

// ─── Documented permissive behavior ──────────────────────────

test('LaunchAppInputSchema accepts empty strings (z.string() has no min length)', () => {
  const parsed = LaunchAppInputSchema.parse({ deviceId: '', bundleId: '' });
  expect(parsed.deviceId).toBe('');
  expect(parsed.bundleId).toBe('');
});

test('LaunchAppInputSchema strips unknown keys (non-strict object)', () => {
  const parsed = LaunchAppInputSchema.parse({
    deviceId: 'device-1',
    bundleId: 'com.example.app',
    env: { DEBUG: '1' },
  });
  expect((parsed as Record<string, unknown>).env).toBeUndefined();
  expect(Object.keys(parsed).sort()).toEqual(['bundleId', 'deviceId']);
});

// ─── Re-export identity across module surfaces ───────────────

test('LaunchAppInputSchema is the identical object via device-types and index barrel', () => {
  expect(FromDeviceTypes).toBe(LaunchAppInputSchema);
  expect(FromIndex).toBe(LaunchAppInputSchema);
});
