/**
 * IProxyTunnel — Mac→device USB tunnel for the WDA HTTP port.
 *
 * G5 spike finding (2026-08-28): on real devices, WDA listens on the device's
 * localhost only; a usbmuxd tunnel (`iproxy <local> <device>`) is REQUIRED
 * before anything on the Mac (WdaManager.waitForReady, Appium webDriverAgentUrl)
 * can reach it. Simulators bind locally and need no tunnel.
 *
 * Dependency-injected (spawn/fetch/binary path) so the manager is unit-testable
 * without libimobiledevice installed.
 */

/** Minimal spawn surface — matches Bun.spawn for the real implementation. */
export interface TunnelSpawnHandle {
  readonly pid: number | undefined;
  readonly exited: Promise<number>;
  kill(): void;
}

export type TunnelSpawnFn = (
  cmd: string[],
  options: { stdout: 'pipe'; stderr: 'pipe'; signal?: AbortSignal },
) => TunnelSpawnHandle;

export type TunnelFetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface IProxyTunnelDeps {
  /** iproxy binary path. Default: resolved from PATH. */
  readonly iproxyPath?: string;
  /** Spawn implementation. Default: Bun.spawn. */
  readonly spawnFn?: TunnelSpawnFn;
  /** Fetch implementation for health checks. Default: global fetch. */
  readonly fetchFn?: TunnelFetchFn;
  /** Abort signal for the tunnel process. */
  readonly signal?: AbortSignal;
}

export interface TunnelEnsureInput {
  readonly udid: string;
  /** Mac-side port (default 8100). */
  readonly localPort?: number;
  /** Device-side WDA port (default 8100). */
  readonly devicePort?: number;
}

export interface TunnelHealthResult {
  readonly reachable: boolean;
  readonly reason?: string;
}

const REAL_SPAWN: TunnelSpawnFn = (cmd, options) =>
  Bun.spawn(cmd, options) as unknown as TunnelSpawnHandle;

export class IProxyTunnel {
  private readonly iproxyPath: string;
  private readonly spawnFn: TunnelSpawnFn;
  private readonly fetchFn: TunnelFetchFn;
  private readonly signal: AbortSignal | undefined;
  private handle: TunnelSpawnHandle | null = null;
  private activeKey: string | null = null;

  constructor(deps: IProxyTunnelDeps = {}) {
    this.iproxyPath = deps.iproxyPath ?? 'iproxy';
    this.spawnFn = deps.spawnFn ?? REAL_SPAWN;
    this.fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init));
    this.signal = deps.signal;
  }

  /** Whether a tunnel process is currently held by this manager. */
  isRunning(): boolean {
    return this.handle !== null;
  }

  /**
   * Ensure a tunnel exists for the device port. Idempotent: reuses the
   * existing process when the same udid/ports are already tunneled.
   */
  ensure(input: TunnelEnsureInput): { localPort: number } {
    const localPort = input.localPort ?? 8100;
    const devicePort = input.devicePort ?? 8100;
    const key = `${input.udid}:${localPort}:${devicePort}`;

    if (this.handle !== null && this.activeKey === key) {
      return { localPort };
    }

    this.stop();

    this.handle = this.spawnFn(
      [this.iproxyPath, String(localPort), String(devicePort), '--udid', input.udid],
      { stdout: 'pipe', stderr: 'pipe', signal: this.signal },
    );
    this.activeKey = key;
    return { localPort };
  }

  /**
   * Probe the tunneled WDA endpoint. Returns reachable=false with the error
   * reason on failure (R5: never silently assume healthy).
   */
  async healthCheck(localPort: number, timeoutMs = 5000): Promise<TunnelHealthResult> {
    if (this.handle === null) {
      return { reachable: false, reason: 'tunnel not started' };
    }
    try {
      const resp = await this.fetchFn(`http://127.0.0.1:${localPort}/status`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) {
        return { reachable: false, reason: `WDA /status HTTP ${resp.status}` };
      }
      return { reachable: true };
    } catch (err) {
      return {
        reachable: false,
        reason: `WDA /status unreachable: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Stop the tunnel process. Idempotent. */
  stop(): void {
    if (this.handle === null) return;
    try {
      this.handle.kill();
    } catch {
      // Best-effort — process may have already exited.
    }
    this.handle = null;
    this.activeKey = null;
  }
}

/** Convenience factory. */
export function createIProxyTunnel(deps: IProxyTunnelDeps = {}): IProxyTunnel {
  return new IProxyTunnel(deps);
}
