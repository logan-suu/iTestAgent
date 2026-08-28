import { describe, expect, it } from 'bun:test';
import { createMemoryProfileCliFactory } from '../src/memory-profile-factory.js';

describe('createMemoryProfileCliFactory', () => {
  it('resolves a sensible default', () => {
    const result = createMemoryProfileCliFactory({});
    expect(result).toBeDefined();
  });
});
