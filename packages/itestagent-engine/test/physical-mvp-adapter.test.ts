import { describe, expect, it } from 'bun:test';
import { createPhysicalMvpAdapter } from '../src/physical-mvp-adapter.js';

describe('createPhysicalMvpAdapter', () => {
  it('wraps an injected device handle into an MVP lane', async () => {
    const adapter = createPhysicalMvpAdapter({
      deviceHandle: { pid: 1, isRunning: async () => true, stop: async () => {} },
    });
    expect(await adapter.isReady()).toBe(true);
  });
});
