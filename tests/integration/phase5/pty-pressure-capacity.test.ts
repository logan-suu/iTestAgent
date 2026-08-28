import { describe, expect, it } from 'bun:test';
import { ptyPressureCapacityProbe } from './helpers/pty-pressure-test-support.js';

describe('Phase 5 PTY pressure capacity', () => {
  it('exposes the pressure-capacity probe', () => {
    expect(typeof ptyPressureCapacityProbe).toBe('function');
  });
});
