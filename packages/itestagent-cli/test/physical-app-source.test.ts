import { describe, expect, it } from 'bun:test';
import { resolveAppSource } from '../src/physical-app-source.js';

describe('resolveAppSource', () => {
  it('accepts an injected app bundle id', () => {
    expect(resolveAppSource({ appBundleId: 'com.example.fixture' }).appBundleId).toBe(
      'com.example.fixture',
    );
  });
});
