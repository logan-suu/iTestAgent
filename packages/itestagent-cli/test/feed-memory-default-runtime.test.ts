import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryDefaultRuntime } from '../src/feed-memory-default-runtime.js';

describe('resolveFeedMemoryDefaultRuntime', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryDefaultRuntime();
    expect(result).toBeDefined();
  });
});
