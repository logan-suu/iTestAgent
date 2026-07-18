/**
 * Doctor check unit tests — Appium and WDA.
 *
 * Tests three-state behavior per US-1.2 AC1 + US-1.3 AC1
 * ("backend not ready" recognition).
 */
import { describe, expect, test } from 'bun:test';
import { checkAppium } from '../../src/doctor/checks/check-appium.js';
import { checkWda } from '../../src/doctor/checks/check-wda.js';

describe('checkAppium', () => {
  test('returns structured result with name', async () => {
    const result = await checkAppium();
    expect(result.name).toBe('Appium');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('message is non-empty', async () => {
    const result = await checkAppium();
    expect(result.message.length).toBeGreaterThan(0);
  });

  test('fixGuide for fail gives install steps', async () => {
    const result = await checkAppium();
    if (result.status === 'fail') {
      expect(result.fixGuide).toBeDefined();
      expect(result.fixGuide?.length).toBeGreaterThan(0);
      // At minimum, guidance should mention appium
      const allSteps = result.fixGuide?.join(' ');
      expect(allSteps).toMatch(/appium/i);
    }
  });
});

describe('checkWda', () => {
  test('returns structured result with name', async () => {
    const result = await checkWda();
    expect(result.name).toBe('WebDriverAgent (WDA)');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('fixGuide exists when status is not pass', async () => {
    const result = await checkWda();
    if (result.status !== 'pass') {
      expect(result.fixGuide).toBeDefined();
      expect(result.fixGuide?.length).toBeGreaterThan(0);
    }
  });

  test('manual status mentions signing for physical devices', async () => {
    const result = await checkWda();
    if (result.status === 'manual' && result.fixGuide) {
      const allSteps = result.fixGuide.join(' ');
      expect(allSteps).toMatch(/physical|simulator|signing/i);
    }
  });
});
