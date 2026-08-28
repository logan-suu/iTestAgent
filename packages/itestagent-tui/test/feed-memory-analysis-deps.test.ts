import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryAnalysisDeps } from '../src/feed-memory-analysis-deps.js';

describe('resolveFeedMemoryAnalysisDeps', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryAnalysisDeps({});
    expect(result).toBeDefined();
  });
});
