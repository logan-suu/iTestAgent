import { describe, expect, it } from 'bun:test';
import { resolveFeedMemoryDeviceSelection } from '../src/feed-memory-device-selection.js';

describe('resolveFeedMemoryDeviceSelection', () => {
  it('resolves a sensible default', () => {
    const result = resolveFeedMemoryDeviceSelection({});
    expect(result).toBeDefined();
  });
});
