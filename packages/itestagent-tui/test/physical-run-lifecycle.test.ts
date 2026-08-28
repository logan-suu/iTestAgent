import { describe, expect, it } from 'bun:test';
import { createPhysicalRun } from '../src/physical-run.js';

describe('createPhysicalRun', () => {
  it('starts in created state', () => {
    expect(createPhysicalRun({ runId: 'r1' }).state).toBe('created');
  });
});
