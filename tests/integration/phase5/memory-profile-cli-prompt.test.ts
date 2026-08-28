// ─── B36: scenario registry seam ───────────────────────────────────

import { describe, expect, it } from 'bun:test';

describe('B36 scenario registry seam', () => {
  it('exposes the scenario registry', async () => {
    const mod = await import(
      '../../../packages/itestagent-contracts/src/scenarios/scenario-registry.js'
    );
    expect(typeof mod.createScenarioRegistry).toBe('function');
  });
});
