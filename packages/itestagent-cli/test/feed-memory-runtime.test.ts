import { describe, expect, it } from 'bun:test';
import { createFeedMemoryRuntime } from '../src/feed-memory-runtime.js';

describe('createFeedMemoryRuntime', () => {
  it('starts in setup phase', () => {
    expect(createFeedMemoryRuntime().phase).toBe('setup');
  });
});
