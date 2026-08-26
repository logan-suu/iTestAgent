import { describe, expect, it } from 'bun:test';
import { resolveDefaultRuntime } from '../src/memory-profile-default-runtime.js';

describe('resolveDefaultRuntime', () => {
  it('resolves a sensible default', () => {
    const result = resolveDefaultRuntime();
    expect(result).toBeDefined();
  });
});
