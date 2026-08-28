import { describe, expect, it } from 'bun:test';
import { resolveStartupBrand } from '../src/startup-brand.js';

describe('resolveStartupBrand', () => {
  it('returns the product name by default', () => {
    expect(resolveStartupBrand({}).name).toBe('iTestAgent');
  });
});
