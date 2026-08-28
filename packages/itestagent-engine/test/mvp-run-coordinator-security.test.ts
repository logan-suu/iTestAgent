import { describe, expect, it } from 'bun:test';
import { createMvpRunCoordinator } from '../src/mvp-run-coordinator.js';

describe('createMvpRunCoordinator security', () => {
  it('blocks execution when the safety gate denies (R7)', async () => {
    const coordinator = createMvpRunCoordinator({
      safetyGate: async () => false,
      setup: async () => {},
      execute: async () => {},
      cleanup: async () => {},
    });
    const result = await coordinator.run();
    expect(result.ok).toBe(false);
  });
});
