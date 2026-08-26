import { describe, expect, it } from 'bun:test';
import { resolveSimulatorSelection } from '../src/simulator-selection.js';

describe('resolveSimulatorSelection', () => {
  it('defaults to the booted simulator', () => {
    expect(resolveSimulatorSelection({}).selector).toBe('booted');
  });
  it('resolves by udid when provided', () => {
    expect(resolveSimulatorSelection({ udid: 'SIM-1' }).udid).toBe('SIM-1');
  });
});
