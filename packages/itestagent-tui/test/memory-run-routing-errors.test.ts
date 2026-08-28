import { describe, expect, it } from 'bun:test';
import { routeMemoryRun } from '../src/memory-run-routing.js';

describe('routeMemoryRun', () => {
  it('routes a memory run when the profile is ready', () => {
    expect(routeMemoryRun({ profileReady: true }).routed).toBe(true);
  });
});
