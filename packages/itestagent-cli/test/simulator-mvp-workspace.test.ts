import { describe, expect, it } from 'bun:test';
import { resolveSimulatorWorkspace } from '../src/simulator-mvp-workspace.js';

describe('resolveSimulatorWorkspace', () => {
  it('passes through the workspace path', () => {
    expect(resolveSimulatorWorkspace({ path: '/fixture' }).path).toBe('/fixture');
  });
});
