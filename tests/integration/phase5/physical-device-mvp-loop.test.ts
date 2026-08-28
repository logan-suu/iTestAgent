import { describe, expect, it } from 'bun:test';
import { physicalMvpLoopProbe } from './helpers/physical-mvp-loop-test-support.js';

describe('Phase 5 physical device MVP loop', () => {
  it('exposes the mvp-loop probe', () => {
    expect(typeof physicalMvpLoopProbe).toBe('function');
  });
});
