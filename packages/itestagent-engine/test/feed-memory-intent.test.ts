import { describe, expect, it } from 'bun:test';
import { buildFeedMemoryIntent } from '../src/feed-memory-intent.js';

describe('buildFeedMemoryIntent', () => {
  it('builds a feed-memory intent with an injected app id', () => {
    const intent = buildFeedMemoryIntent({ appBundleId: 'com.example.fixture' });
    expect(intent.appBundleId).toBe('com.example.fixture');
    expect(intent.scope).toBe('feed-memory');
  });
});
