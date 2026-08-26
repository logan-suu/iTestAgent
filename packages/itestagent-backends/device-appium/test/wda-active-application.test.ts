import { describe, expect, it } from 'bun:test';
import { parseActiveBundleId } from '../src/wda-active-application.js';

describe('parseActiveBundleId', () => {
  it('extracts the bundle id from a WDA status payload', () => {
    const status = JSON.stringify({ value: { activeApp: 'com.example.fixture' } });
    expect(parseActiveBundleId(status)).toBe('com.example.fixture');
  });
  it('returns null when absent', () => {
    expect(parseActiveBundleId('{}')).toBeNull();
  });
});
