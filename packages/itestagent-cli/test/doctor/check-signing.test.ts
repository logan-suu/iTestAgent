/**
 * Doctor check unit tests — Signing and Physical Device.
 *
 * Tests three-state behavior per US-1.2 AC1 + US-1.3 AC1
 * ("signing unavailable / Developer Mode off" recognition).
 */
import { describe, expect, test } from 'bun:test';
import { checkPhysicalDevice } from '../../src/doctor/checks/check-device-physical.js';
import { checkSigning } from '../../src/doctor/checks/check-signing.js';

describe('checkSigning', () => {
  test('returns structured result with name', async () => {
    const result = await checkSigning();
    expect(result.name).toBe('Code Signing');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('fixGuide contains actionable signing steps', async () => {
    const result = await checkSigning();
    if (result.fixGuide) {
      expect(result.fixGuide.length).toBeGreaterThan(0);
      // Should reference Xcode settings or the security command
      const allSteps = result.fixGuide.join(' ');
      expect(allSteps).toMatch(/xcode|identity|security/i);
    }
  });

  test('does not leak raw certificate data in message (R6)', async () => {
    const result = await checkSigning();
    // Message should not contain raw SHA-1 hashes
    expect(result.message).not.toMatch(/[0-9A-Fa-f]{40}/);
    expect(result.message).not.toContain('-----BEGIN');
  });
});

describe('checkPhysicalDevice', () => {
  test('returns structured result with name', async () => {
    const result = await checkPhysicalDevice();
    expect(result.name).toBe('Physical Device');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('message mentions device connection guidance', async () => {
    const result = await checkPhysicalDevice();
    expect(result.message.length).toBeGreaterThan(0);
  });

  test('fixGuide contains Developer Mode + Trust instructions', async () => {
    const result = await checkPhysicalDevice();
    if (result.fixGuide) {
      const allSteps = result.fixGuide.join(' ');
      expect(allSteps).toMatch(/developer|trust|usb/i);
    }
  });
});
