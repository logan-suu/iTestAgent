import { describe, expect, it } from 'bun:test';
import { resolveMemoryProfileRunRoot } from '../src/memory-profile-run-root.js';

describe('resolveMemoryProfileRunRoot', () => {
  it('resolves a sensible default', () => {
    const result = resolveMemoryProfileRunRoot({});
    expect(result).toBeDefined();
  });
});
