import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryAnalysisFailure } from '../src/feed-memory-analysis-failure.js';

describe('resolveFeedMemoryAnalysisFailure', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryAnalysisFailure({});
    expect(result).toBeDefined();
  });
});
