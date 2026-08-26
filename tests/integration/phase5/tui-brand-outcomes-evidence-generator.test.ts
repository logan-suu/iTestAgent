// ─── B31: startup-brand seam ───────────────────────────────────────

import { describe, expect, it } from 'bun:test';

describe('B31 startup-brand seam', () => {
  it('exposes the startup brand resolver', async () => {
    const mod = await import('../../../packages/itestagent-tui/src/startup-brand.js');
    expect(typeof mod.resolveStartupBrand).toBe('function');
  });
});
