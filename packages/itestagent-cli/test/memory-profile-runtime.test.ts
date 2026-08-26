import { describe, expect, it } from 'bun:test';
import { createMemoryProfileCliRuntime } from '../src/memory-profile-runtime.js';

describe('createMemoryProfileCliRuntime', () => {
  it('resolves a sensible default', () => {
    const result = createMemoryProfileCliRuntime();
    expect(result).toBeDefined();
  });
});
