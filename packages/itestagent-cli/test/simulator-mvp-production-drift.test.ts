import { describe, expect, it } from 'bun:test';
import { detectProductionDrift } from '../src/simulator-mvp-production.js';

describe('detectProductionDrift', () => {
  it('flags a mismatch between expected and installed bundle', () => {
    expect(detectProductionDrift({ expected: 'a', installed: 'b' }).drifted).toBe(true);
  });
});
