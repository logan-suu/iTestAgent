/**
 * IProxyTunnel tests — injected spawn/fetch, no libimobiledevice required.
 */
import { describe, expect, it } from 'bun:test';
import { type TunnelSpawnHandle, createIProxyTunnel } from '../src/iproxy-tunnel.js';

function fakeSpawn(recorder: { cmds: string[][] }, exited?: Promise<number>) {
  return ((cmd: string[]) => {
    recorder.cmds.push(cmd);
    const handle: TunnelSpawnHandle = {
      pid: 4242,
      // Per-handle exit promise (CodeRabbit #11): never resolves unless the
      // test explicitly resolves it via deferredExit().
      exited: exited ?? new Promise<number>(() => {}),
      kill() {},
    };
    return handle;
  }) as never;
}

function deferredExit(): { exited: Promise<number>; exit: (code: number) => void } {
  let exit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    exit = resolve;
  });
  return { exited, exit };
}

describe('IProxyTunnel', () => {
  it('ensure spawns iproxy with udid and ports', () => {
    const recorder = { cmds: [] as string[][] };
    const tunnel = createIProxyTunnel({
      iproxyPath: '/fake/iproxy',
      spawnFn: fakeSpawn(recorder),
      fetchFn: async () => new Response('{}', { status: 200 }),
    });
    const { localPort } = tunnel.ensure({ udid: 'UDID-1', localPort: 8200, devicePort: 8100 });
    expect(localPort).toBe(8200);
    expect(recorder.cmds[0]).toEqual(['/fake/iproxy', '8200', '8100', '--udid', 'UDID-1']);
    expect(tunnel.isRunning()).toBe(true);
  });

  it('ensure is idempotent for the same device+ports', () => {
    const recorder = { cmds: [] as string[][] };
    const tunnel = createIProxyTunnel({
      spawnFn: fakeSpawn(recorder),
      fetchFn: async () => new Response('{}', { status: 200 }),
    });
    tunnel.ensure({ udid: 'U1' });
    tunnel.ensure({ udid: 'U1' });
    expect(recorder.cmds).toHaveLength(1);
    tunnel.ensure({ udid: 'U2' });
    expect(recorder.cmds).toHaveLength(2);
  });

  it('invalidates the handle when the process exits on its own', async () => {
    const recorder = { cmds: [] as string[][] };
    const { exited, exit } = deferredExit();
    const tunnel = createIProxyTunnel({
      spawnFn: fakeSpawn(recorder, exited),
      fetchFn: async () => new Response('{}', { status: 200 }),
    });
    tunnel.ensure({ udid: 'U1' });
    expect(tunnel.isRunning()).toBe(true);

    exit(1);
    await exited;
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(tunnel.isRunning()).toBe(false);

    tunnel.ensure({ udid: 'U1' });
    expect(recorder.cmds).toHaveLength(2);
    expect(tunnel.isRunning()).toBe(true);
  });

  it('healthCheck reports reachable when /status responds ok', async () => {
    const tunnel = createIProxyTunnel({
      spawnFn: fakeSpawn({ cmds: [] }),
      fetchFn: async () => new Response('{"value":{"ready":true}}', { status: 200 }),
    });
    tunnel.ensure({ udid: 'U1' });
    const health = await tunnel.healthCheck(8100);
    expect(health.reachable).toBe(true);
  });

  it('healthCheck reports unreachable without a tunnel', async () => {
    const tunnel = createIProxyTunnel({
      spawnFn: fakeSpawn({ cmds: [] }),
      fetchFn: async () => new Response('{}', { status: 200 }),
    });
    const health = await tunnel.healthCheck(8100);
    expect(health.reachable).toBe(false);
    expect(health.reason).toBe('tunnel not started');
  });

  it('healthCheck surfaces the connection reason on failure', async () => {
    const tunnel = createIProxyTunnel({
      spawnFn: fakeSpawn({ cmds: [] }),
      fetchFn: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    tunnel.ensure({ udid: 'U1' });
    const health = await tunnel.healthCheck(8100);
    expect(health.reachable).toBe(false);
    expect(health.reason).toContain('ECONNREFUSED');
  });

  it('stop kills the process and is idempotent', () => {
    let killed = 0;
    const spawnFn = ((_cmd: string[]) => {
      const handle: TunnelSpawnHandle = {
        pid: 1,
        exited: Promise.resolve(0),
        kill() {
          killed += 1;
        },
      };
      return handle;
    }) as never;
    const tunnel = createIProxyTunnel({ spawnFn, fetchFn: async () => new Response('{}') });
    tunnel.ensure({ udid: 'U1' });
    tunnel.stop();
    tunnel.stop();
    expect(killed).toBe(1);
    expect(tunnel.isRunning()).toBe(false);
  });
});
