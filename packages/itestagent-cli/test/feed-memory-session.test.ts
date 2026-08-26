import { describe, expect, it } from 'bun:test';
import { createFeedMemorySession } from '../src/feed-memory-session.js';

describe('createFeedMemorySession', () => {
  it('resolves a sensible default', () => {
    const result = createFeedMemorySession({});
    expect(result).toBeDefined();
  });
});
