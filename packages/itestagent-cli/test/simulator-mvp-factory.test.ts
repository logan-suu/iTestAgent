import { describe, expect, it } from 'bun:test';
import { createSimulatorMvpFactory } from '../src/simulator-mvp-factory.js';

describe('createSimulatorMvpFactory', () => {
  it('exposes a create function', () => {
    expect(typeof createSimulatorMvpFactory({}).create).toBe('function');
  });
});
