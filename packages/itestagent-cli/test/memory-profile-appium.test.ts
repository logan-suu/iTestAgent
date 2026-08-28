import { describe, expect, it } from 'bun:test';
import { resolveAppiumPort } from '../src/memory-profile-appium.js';

describe('resolveAppiumPort', () => {
  it('resolves a sensible default', () => {
    const result = resolveAppiumPort({});
    expect(result).toBeDefined();
  });
});
