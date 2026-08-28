import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryProfile } from '../src/feed-memory-profile.js';

describe('resolveFeedMemoryProfile', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryProfile({});
    expect(result).toBeDefined();
  });
});
