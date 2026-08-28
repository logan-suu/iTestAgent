import { describe, expect, it } from 'bun:test';
import { resolveTransientBuild } from '../src/memory-profile-transient-build.js';

describe('resolveTransientBuild', () => {
  it('resolves a sensible default', () => {
    const result = resolveTransientBuild({});
    expect(result).toBeDefined();
  });
});
