import { describe, expect, it } from 'bun:test';
import { createAppiumProcessManager } from '../src/appium-process-manager.js';

describe('createAppiumProcessManager', () => {
  it('starts an Appium server process via the injected spawn', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const manager = createAppiumProcessManager({
      spawn: async (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 42 };
      },
      kill: () => true,
    });
    const handle = await manager.start({ port: 4723 });
    expect(handle.pid).toBe(42);
    expect(calls[0]?.args).toContain('--port');
  });
});
