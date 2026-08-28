import { describe, expect, it } from 'bun:test';
import { createSimulatorMvpAdapter } from '../src/simulator-mvp-adapter.js';

describe('createSimulatorMvpAdapter', () => {
  it('reports readiness for an injected simulator handle', async () => {
    const adapter = createSimulatorMvpAdapter({
      isSimulatorBooted: async () => true,
    });
    expect(await adapter.isReady()).toBe(true);
  });
});
