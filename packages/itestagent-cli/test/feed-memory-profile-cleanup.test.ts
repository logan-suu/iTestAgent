import { describe, expect, it } from 'bun:test';
import { createFeedMemoryRuntimeCleanup } from '../src/feed-memory-runtime-cleanup.js';

describe('createFeedMemoryRuntimeCleanup', () => {
  it('exposes a run cleanup', () => {
    expect(typeof createFeedMemoryRuntimeCleanup({}).run).toBe('function');
  });
});
