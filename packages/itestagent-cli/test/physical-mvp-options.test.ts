import { describe, expect, it } from 'bun:test';
import { resolveMvpOptions } from '../src/physical-mvp-options.js';

describe('resolveMvpOptions', () => {
  it('applies default mvp options', () => {
    expect(resolveMvpOptions({}).collectEvidence).toBe(true);
  });
});
