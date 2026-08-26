import { describe, expect, it } from 'bun:test';
import { buildMemoryProfileIntent } from '../src/memory-profile-intent.js';

describe('buildMemoryProfileIntent', () => {
  it('builds a memory-profile intent with calibration defaults', () => {
    const intent = buildMemoryProfileIntent({});
    expect(intent.thresholdMB).toBe(20);
    expect(intent.scope).toBe('memory-profile');
  });
});
