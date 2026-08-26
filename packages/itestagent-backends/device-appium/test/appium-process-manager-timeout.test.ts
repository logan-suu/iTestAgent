import { describe, expect, it } from 'bun:test';
import { createAppiumProcessManager } from '../src/appium-process-manager.js';

describe('createAppiumProcessManager timeout', () => {
  it('stop() kills the process group', async () => {
    const killed: number[] = [];
    const manager = createAppiumProcessManager({
      spawn: async () => ({ pid: 7 }),
      kill: (pid: number) => {
        killed.push(pid);
        return true;
      },
    });
    const handle = await manager.start({});
    await handle.stop();
    expect(killed).toContain(7);
  });
});
