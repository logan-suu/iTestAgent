import { describe, expect, it } from 'bun:test';
import { shadowReadCompare } from '../src/scenarios/registry-shadow-read.js';

describe('shadowReadCompare', () => {
  it('reports equal when canonicalized outputs match', () => {
    expect(shadowReadCompare({ a: 1 }, { a: 1 }).equal).toBe(true);
  });
  it('reports a diagnostic when outputs differ', () => {
    const result = shadowReadCompare({ a: 1 }, { a: 2 });
    expect(result.equal).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
