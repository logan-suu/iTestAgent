import { describe, expect, it } from 'bun:test';
import { isProcessAlive } from '../src/appium-process-liveness.js';

describe('isProcessAlive', () => {
  it('reports alive when signal(pid, 0) does not throw', () => {
    expect(isProcessAlive(999999, { signal: () => true })).toBe(true);
  });
  it('reports dead on ESRCH', () => {
    const err = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    expect(
      isProcessAlive(999999, {
        signal: () => {
          throw err;
        },
      }),
    ).toBe(false);
  });
});
