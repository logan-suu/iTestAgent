import { describe, expect, it } from 'bun:test';
import { resolveMemoryProfileReportContext } from '../src/memory-profile-report-context.js';

describe('resolveMemoryProfileReportContext', () => {
  it('resolves a sensible default', () => {
    const result = resolveMemoryProfileReportContext({ runId: 'r1' });
    expect(result).toBeDefined();
  });
});
