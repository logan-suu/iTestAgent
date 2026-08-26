import { describe, expect, it } from 'bun:test';
import { differentialCompare } from '../src/scenarios/scenario-registry.js';

describe('differentialCompare', () => {
  it('reports equal for matching canonicalized payloads', () => {
    expect(differentialCompare({ a: 1 }, { a: 1 }).equal).toBe(true);
  });
});
