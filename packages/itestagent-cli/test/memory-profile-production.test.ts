import { describe, expect, it } from 'bun:test';
import { resolveMemoryProfileProduction } from '../src/memory-profile-production.js';

describe('resolveMemoryProfileProduction', () => {
  it('resolves a sensible default', () => {
    const result = resolveMemoryProfileProduction({});
    expect(result).toBeDefined();
  });
});
