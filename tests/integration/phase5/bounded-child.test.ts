import { describe, expect, it } from 'bun:test';
import { boundedChildProbe } from './helpers/bounded-child.js';

describe('Phase 5 bounded child', () => {
  it('exposes the bounded-child probe', () => {
    expect(typeof boundedChildProbe).toBe('function');
  });
});
