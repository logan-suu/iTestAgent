/**
 * Doctor simulator check unit tests — simctl, runtime, sdk, device, appium-wda.
 *
 * US-1.2 AC1: three-state pass/fail/manual per check.
 * US-1.3 AC1: "backend not ready" recognition.
 * 避坑手册 §3: signing/Developer Mode/trust → N/A for Simulator.
 *
 * Tests run with real CLI commands (matching existing test convention).
 * Structural assertions work even when tools are absent.
 */
import { describe, expect, test } from 'bun:test';
import { checkSimctl } from '../../src/doctor/checks/check-simctl.js';
import { checkSimulatorAppiumWda } from '../../src/doctor/checks/check-simulator-appium-wda.js';
import { checkSimulatorDevice } from '../../src/doctor/checks/check-simulator-device.js';
import { checkSimulatorRuntime } from '../../src/doctor/checks/check-simulator-runtime.js';
import { checkSimulatorSdk } from '../../src/doctor/checks/check-simulator-sdk.js';

// ════════════════════════════════════════════════════════════
// checkSimctl
// ════════════════════════════════════════════════════════════
describe('checkSimctl', () => {
  test('returns structured result with name', async () => {
    const result = await checkSimctl();
    expect(result.name).toBe('simctl');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('message is non-empty', async () => {
    const result = await checkSimctl();
    expect(result.message.length).toBeGreaterThan(0);
  });

  test('fixGuide gives install steps when failed', async () => {
    const result = await checkSimctl();
    if (result.status === 'fail') {
      expect(result.fixGuide).toBeDefined();
      expect(result.fixGuide?.length).toBeGreaterThan(0);
      const allSteps = result.fixGuide?.join(' ');
      expect(allSteps).toMatch(/xcode/i);
    }
  });
});

// ════════════════════════════════════════════════════════════
// checkSimulatorRuntime
// ════════════════════════════════════════════════════════════
describe('checkSimulatorRuntime', () => {
  test('returns structured result with name', async () => {
    const result = await checkSimulatorRuntime();
    expect(result.name).toBe('Simulator Runtime');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('details are present when status is pass', async () => {
    const result = await checkSimulatorRuntime();
    if (result.status === 'pass') {
      expect(result.details).toBeDefined();
      expect(result.details?.length).toBeGreaterThan(0);
    }
  });

  test('fixGuide mentions Xcode Platforms when failed', async () => {
    const result = await checkSimulatorRuntime();
    if (result.status === 'fail') {
      expect(result.fixGuide).toBeDefined();
      const allSteps = result.fixGuide?.join(' ');
      expect(allSteps).toMatch(/platforms|runtime/i);
    }
  });
});

// ════════════════════════════════════════════════════════════
// checkSimulatorSdk
// ════════════════════════════════════════════════════════════
describe('checkSimulatorSdk', () => {
  test('returns structured result with name', async () => {
    const result = await checkSimulatorSdk();
    expect(result.name).toBe('Simulator SDK');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('details include SDK path when passed', async () => {
    const result = await checkSimulatorSdk();
    if (result.status === 'pass' && result.details) {
      expect(result.details).toMatch(/SDK path:/);
    }
  });

  test('fixGuide mentions xcrun when failed', async () => {
    const result = await checkSimulatorSdk();
    if (result.status === 'fail') {
      expect(result.fixGuide).toBeDefined();
      const allSteps = result.fixGuide?.join(' ');
      expect(allSteps).toMatch(/xcrun|xcodebuild/i);
    }
  });
});

// ════════════════════════════════════════════════════════════
// checkSimulatorDevice
// ════════════════════════════════════════════════════════════
describe('checkSimulatorDevice', () => {
  test('returns structured result with name', async () => {
    const result = await checkSimulatorDevice();
    expect(result.name).toBe('Simulator Device');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('manual status mentions boot time (30-60s)', async () => {
    const result = await checkSimulatorDevice();
    if (result.status === 'manual') {
      expect(result.message).toMatch(/30-?60s|boot/i);
    }
  });

  test('fixGuide exists for all statuses except pass', async () => {
    const result = await checkSimulatorDevice();
    if (result.status !== 'pass') {
      expect(result.fixGuide).toBeDefined();
      expect(result.fixGuide?.length).toBeGreaterThan(0);
    }
  });

  test('message mentions available devices count', async () => {
    const result = await checkSimulatorDevice();
    if (result.status !== 'fail') {
      expect(result.message).toMatch(/\d+ simulator device\(s\)/);
    }
  });
});

// ════════════════════════════════════════════════════════════
// checkSimulatorAppiumWda
// ════════════════════════════════════════════════════════════
describe('checkSimulatorAppiumWda', () => {
  test('returns structured result with name', async () => {
    const result = await checkSimulatorAppiumWda();
    expect(result.name).toBe('Appium WDA (Simulator)');
    expect(['pass', 'fail', 'manual']).toContain(result.status);
    expect(typeof result.message).toBe('string');
  });

  test('never returns pass (always manual or fail)', async () => {
    const result = await checkSimulatorAppiumWda();
    expect(result.status).not.toBe('pass');
  });

  test('manual status mentions signing is N/A for Simulator', async () => {
    const result = await checkSimulatorAppiumWda();
    if (result.status === 'manual' && result.fixGuide) {
      const allSteps = result.fixGuide.join(' ');
      expect(allSteps).toMatch(/N\/A|no signing|signing.*not/i);
    }
  });

  test('fixGuide mentions Appium install steps when failed', async () => {
    const result = await checkSimulatorAppiumWda();
    if (result.status === 'fail' && result.fixGuide) {
      const allSteps = result.fixGuide.join(' ');
      expect(allSteps).toMatch(/appium/i);
    }
  });
});
