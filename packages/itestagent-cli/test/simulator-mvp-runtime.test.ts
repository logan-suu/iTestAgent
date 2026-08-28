import { describe, expect, it } from 'bun:test';
import { createSimulatorMvpRuntime } from '../src/simulator-mvp-runtime.js';

describe('createSimulatorMvpRuntime', () => {
  it('starts in setup phase', () => {
    expect(createSimulatorMvpRuntime().phase).toBe('setup');
  });
});
