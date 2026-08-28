import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryReport } from '../src/feed-memory-report.js';

describe('resolveFeedMemoryReport', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryReport({ runId: 'r1' });
    expect(result).toBeDefined();
  });
});
