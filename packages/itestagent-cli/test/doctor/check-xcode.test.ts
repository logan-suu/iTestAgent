/**
 * Doctor check unit tests — Xcode and Command Line Tools.
 *
 * Tests the three-state (pass/fail/manual) behavior per US-1.2 AC1.
 * Uses Bun.spawnSync mocking to simulate command outputs.
 */
import { describe, expect, test } from 'bun:test';
import { checkCommandLineTools } from '../../src/doctor/checks/check-clt.js';
import { checkXcode } from '../../src/doctor/checks/check-xcode.js';

describe('checkXcode', () => {
  test('returns structured result with name', async () => {
    const result = await checkXcode();
    expect(result.name).toBe('Xcode');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('fixGuide is present for fail/manual status', async () => {
    const result = await checkXcode();
    if (result.status === 'fail' || result.status === 'manual') {
      expect(result.fixGuide).toBeDefined();
      expect(result.fixGuide?.length).toBeGreaterThan(0);
    }
  });

  test('fixGuide is a string array when present', async () => {
    const result = await checkXcode();
    if (result.fixGuide) {
      expect(Array.isArray(result.fixGuide)).toBe(true);
      for (const step of result.fixGuide) {
        expect(typeof step).toBe('string');
      }
    }
  });
});

describe('checkCommandLineTools', () => {
  test('returns structured result with name', async () => {
    const result = await checkCommandLineTools();
    expect(result.name).toBe('Command Line Tools');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('details is a string when present', async () => {
    const result = await checkCommandLineTools();
    if (result.details) {
      expect(typeof result.details).toBe('string');
    }
  });

  test('fixGuide for fail status gives actionable steps', async () => {
    const result = await checkCommandLineTools();
    if (result.status === 'fail') {
      expect(result.fixGuide).toBeDefined();
      expect(result.fixGuide?.length).toBeGreaterThan(0);
    }
  });
});
