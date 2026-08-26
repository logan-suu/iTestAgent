import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryRunIdentity } from '../src/feed-memory-run-identity.js';

describe('resolveFeedMemoryRunIdentity', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryRunIdentity({});
    expect(result).toBeDefined();
  });
});
