import { describe, expect, it } from 'bun:test';
import { composePhysicalMvp } from '../src/physical-mvp-composition.js';

describe('composePhysicalMvp', () => {
  it('composes injected lanes into a run plan', () => {
    const composed = composePhysicalMvp({ autReady: true, wdaReady: true });
    expect(composed.ok).toBe(true);
  });
});
