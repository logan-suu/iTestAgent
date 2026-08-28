import { describe, expect, it } from 'bun:test';
import { createSelectedDeviceSession } from '../src/feed-memory-device-selection.js';

describe('createSelectedDeviceSession', () => {
  it('resolves a sensible default', () => {
    const result = createSelectedDeviceSession({});
    expect(result).toBeDefined();
  });
});
