import { describe, expect, it } from 'bun:test';
import { probeRouteC } from '../src/physical-route-c-probes.js';

describe('probeRouteC', () => {
  it('reports wda-available when the probe passes', () => {
    expect(probeRouteC({ wdaReady: true }).wdaReady).toBe(true);
  });
});
