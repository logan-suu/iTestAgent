import { describe, expect, it } from 'bun:test';
import { probeAppSource } from '../src/physical-app-source-probes.js';

describe('probeAppSource', () => {
  it('reports app-present when the probe passes', () => {
    expect(probeAppSource({ appPresent: true }).appPresent).toBe(true);
  });
});
