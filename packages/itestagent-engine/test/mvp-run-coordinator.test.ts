import { describe, expect, it } from 'bun:test';
import { createMvpRunCoordinator } from '../src/mvp-run-coordinator.js';

describe('createMvpRunCoordinator', () => {
  it('coordinates setup/execute/cleanup across injected lanes', async () => {
    const calls: string[] = [];
    const coordinator = createMvpRunCoordinator({
      setup: async () => {
        calls.push('setup');
      },
      execute: async () => {
        calls.push('execute');
      },
      cleanup: async () => {
        calls.push('cleanup');
      },
    });
    const result = await coordinator.run();
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['setup', 'execute', 'cleanup']);
  });
});
