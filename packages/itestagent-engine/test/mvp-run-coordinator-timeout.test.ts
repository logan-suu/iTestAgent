import { describe, expect, it } from 'bun:test';
import { createMvpRunCoordinator } from '../src/mvp-run-coordinator.js';

describe('createMvpRunCoordinator timeout', () => {
  it('surfaces a lane timeout as a typed failure', async () => {
    const coordinator = createMvpRunCoordinator({
      setup: async () => {},
      execute: async () => {
        throw new Error('timeout after 5000ms');
      },
      cleanup: async () => {},
    });
    const result = await coordinator.run();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timeout');
  });
});
