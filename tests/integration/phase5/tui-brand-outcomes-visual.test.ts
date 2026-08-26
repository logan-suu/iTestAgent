// ─── B31: run-completion-presentation seam ─────────────────────────

import { describe, expect, it } from 'bun:test';

describe('B31 run-completion seam', () => {
  it('exposes the completion presenter', async () => {
    const mod = await import('../../../packages/itestagent-tui/src/run-completion-presentation.js');
    expect(typeof mod.presentRunCompletion).toBe('function');
  });
});
