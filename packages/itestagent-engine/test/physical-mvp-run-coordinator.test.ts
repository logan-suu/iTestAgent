import { describe, expect, it } from 'bun:test';
import { createPhysicalMvpRunCoordinator } from '../src/physical-mvp-run-coordinator.js';

describe('createPhysicalMvpRunCoordinator', () => {
  it('composes adapter + cleanup into one physical MVP run', async () => {
    const calls: string[] = [];
    const coordinator = createPhysicalMvpRunCoordinator({
      adapter: { isReady: async () => true },
      cleanup: {
        run: async () => {
          calls.push('cleanup');
        },
      },
    });
    const result = await coordinator.run();
    expect(result.ok).toBe(true);
    expect(calls).toContain('cleanup');
  });
});
