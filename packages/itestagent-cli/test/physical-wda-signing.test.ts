import { describe, expect, it } from 'bun:test';
import { resolveWdaSigning } from '../src/physical-wda-signing.js';

describe('resolveWdaSigning', () => {
  it('defaults to no explicit WDA signing identity', () => {
    expect(resolveWdaSigning({}).identity).toBeUndefined();
  });
});
