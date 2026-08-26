import { describe, expect, it } from 'bun:test';
import { createOwnedWdaProcess } from '../src/owned-wda-processes.js';

describe('createOwnedWdaProcess', () => {
  it('reports running and stops the owned WDA process', async () => {
    const killed: number[] = [];
    const wda = createOwnedWdaProcess(99, {
      kill: (pid: number) => {
        killed.push(pid);
        return true;
      },
    });
    expect(await wda.isRunning()).toBe(true);
    await wda.stop();
    expect(killed).toContain(99);
  });
});
