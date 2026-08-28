import { describe, expect, it } from 'bun:test';
import { resolveDebugSigning } from '../src/memory-profile-debug-signing.js';

describe('resolveDebugSigning', () => {
  it('resolves a sensible default', () => {
    const result = resolveDebugSigning({});
    expect(result).toBeDefined();
  });
});
