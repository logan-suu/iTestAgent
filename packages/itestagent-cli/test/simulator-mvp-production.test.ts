import { describe, expect, it } from 'bun:test';
import { resolveSimulatorProduction } from '../src/simulator-mvp-production.js';

describe('resolveSimulatorProduction', () => {
  it('defaults to not built', () => {
    expect(resolveSimulatorProduction({}).built).toBe(false);
  });
});
