/**
 * Tests for DevicectlOps — unit tests with mock spawn functions.
 *
 * Coverage:
 *   - installApp: success / device not found / untrusted / developer mode / locked / generic error
 *   - launchApp: success / app not installed / already running
 *   - terminateApp: success / app not found
 *   - openDeepLink: success / xcrun not found
 */

import { describe, expect, it } from 'bun:test';
import { createDevicectlOps } from '../src/devicectl-ops.js';
import type { SpawnAsyncFn, SpawnSyncFn } from '../src/xcodebuild-build-driver.js';

// ─── Helpers ──────────────────────────────────────────────────────

function syncOk(): ReturnType<SpawnSyncFn> {
  return { exitCode: 0, stdout: '', stderr: '' };
}

function syncErr(stderr: string, exitCode = 1): ReturnType<SpawnSyncFn> {
  return { exitCode, stdout: '', stderr };
}

async function asyncOk(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return { exitCode: 0, stdout: '', stderr: '' };
}

async function asyncErr(
  stderr: string,
  exitCode = 1,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return { exitCode, stdout: '', stderr };
}

function noopSync(): SpawnSyncFn {
  return () => syncOk();
}

// ─── installApp (uses spawnAsync) ─────────────────────────────────

describe('installApp', () => {
  it('installs successfully', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncOk(),
    });
    const result = await ops.installApp('UDID-123', '/path/to/MyApp.app');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error when device not found', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncErr('device not found in available devices'),
    });
    const result = await ops.installApp('UDID-404', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('device "UDID-404" not found');
    expect(result.exitCode).toBe(1);
  });

  it('returns error when device untrusted', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncErr('The device is not trusted for development'),
    });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not trusted');
    expect(result.error).toContain('Trust This Computer');
  });

  it('returns error when developer mode off', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncErr('developer_mode disabled on this device'),
    });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Developer Mode');
  });

  it('returns error when device is locked', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncErr('The device is locked with a passcode'),
    });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('locked');
    expect(result.error).toContain('Unlock');
  });

  it('returns generic error with stderr', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncErr('some unknown installation failure occurred'),
    });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('devicectl install failed');
    expect(result.stderr).toContain('some unknown');
  });

  it('returns generic error when stderr is empty', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncErr(''),
    });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('devicectl install failed');
  });
});

// ─── launchApp (uses spawnAsync) ──────────────────────────────────

describe('launchApp', () => {
  it('launches successfully', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncOk(),
    });
    const result = await ops.launchApp('UDID-123', 'com.example.app');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error when app not installed', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncErr('no such app with bundle identifier com.example.app'),
    });
    const result = await ops.launchApp('UDID-123', 'com.example.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('app not found');
  });

  it('returns error when already running', async () => {
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async () => asyncErr('process is already running'),
    });
    const result = await ops.launchApp('UDID-123', 'com.example.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('already running');
  });

  it('passes launch arguments when provided', async () => {
    let capturedArgs: string[] = [];
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async (_cmd, args) => {
        capturedArgs = args;
        return asyncOk();
      },
    });
    await ops.launchApp('UDID-123', 'com.example.app', ['-debug', '--reset']);
    expect(capturedArgs).toContain('--terminate-existing');
    expect(capturedArgs).toContain('--args');
    expect(capturedArgs).toContain('-debug');
    expect(capturedArgs).toContain('--reset');
  });
});

// ─── terminateApp (uses spawnSync: list processes + terminate by PID) ─

describe('terminateApp', () => {
  it('terminates successfully when app is running', async () => {
    let capturedListArgs: string[] = [];
    let capturedTerminateArgs: string[] = [];
    let callCount = 0;

    const spawnSync: SpawnSyncFn = (_cmd, args) => {
      callCount++;
      if (callCount === 1) {
        capturedListArgs = args;
        return { exitCode: 0, stdout: '1499    /path/TestSwiftUI.app/TestSwiftUI', stderr: '' };
      }
      capturedTerminateArgs = args;
      return syncOk();
    };

    const ops = createDevicectlOps({ spawnSync, spawnAsync: async () => asyncOk() });
    const result = await ops.terminateApp('UDID-123', 'com.example.TestSwiftUI');
    expect(result.success).toBe(true);
    expect(capturedListArgs).toContain('processes');
    expect(capturedTerminateArgs).toContain('terminate');
    expect(capturedTerminateArgs).toContain('--pid');
    expect(capturedTerminateArgs).toContain('1499');
  });

  it('returns error when app is not running', async () => {
    const spawnSync: SpawnSyncFn = () => ({ exitCode: 0, stdout: '', stderr: '' });
    const ops = createDevicectlOps({ spawnSync, spawnAsync: async () => asyncOk() });
    const result = await ops.terminateApp('UDID-123', 'com.missing.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not running');
  });

  it('returns error when process listing fails', async () => {
    const spawnSync: SpawnSyncFn = () => syncErr('device not found');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: async () => asyncOk() });
    const result = await ops.terminateApp('UDID-404', 'com.example.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('device "UDID-404" not found');
  });
});

// ─── openDeepLink (uses spawnSync) ────────────────────────────────

describe('openDeepLink', () => {
  it('opens deep link successfully', async () => {
    const ops = createDevicectlOps({
      spawnSync: () => syncOk(),
      spawnAsync: async () => asyncOk(),
    });
    const result = await ops.openDeepLink('UDID-123', 'com.example.app', 'myapp://profile/123');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error when xcrun not found', async () => {
    const ops = createDevicectlOps({
      spawnSync: () => syncErr('command not found: xcrun'),
      spawnAsync: async () => asyncOk(),
    });
    const result = await ops.openDeepLink('UDID-123', 'com.example.app', 'myapp://test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('command not found');
  });
});

// ─── Command argument verification ────────────────────────────────

describe('command arguments', () => {
  it('installApp calls xcrun devicectl device install app', async () => {
    let capturedArgs: string[] = [];
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async (_cmd, args) => {
        capturedArgs = args;
        return asyncOk();
      },
    });
    await ops.installApp('MY-UDID', '/apps/My.app');
    expect(capturedArgs[0]).toBe('devicectl');
    expect(capturedArgs).toContain('install');
    expect(capturedArgs).toContain('app');
    expect(capturedArgs).toContain('--device');
    expect(capturedArgs).toContain('MY-UDID');
    expect(capturedArgs).toContain('/apps/My.app');
  });

  it('launchApp calls xcrun devicectl device process launch', async () => {
    let capturedArgs: string[] = [];
    const ops = createDevicectlOps({
      spawnSync: noopSync(),
      spawnAsync: async (_cmd, args) => {
        capturedArgs = args;
        return asyncOk();
      },
    });
    await ops.launchApp('MY-UDID', 'com.app.test');
    expect(capturedArgs).toContain('process');
    expect(capturedArgs).toContain('launch');
    expect(capturedArgs).toContain('--device');
    expect(capturedArgs).toContain('MY-UDID');
    expect(capturedArgs).toContain('com.app.test');
  });

  it('terminateApp: list processes then terminate by PID', async () => {
    let capturedListArgs: string[] = [];
    let capturedTerminateArgs: string[] = [];
    let callCount = 0;

    const ops = createDevicectlOps({
      spawnSync: (_cmd, args) => {
        callCount++;
        if (callCount === 1) {
          capturedListArgs = args;
          return { exitCode: 0, stdout: '99    /path/test.app/test', stderr: '' };
        }
        capturedTerminateArgs = args;
        return syncOk();
      },
      spawnAsync: async () => asyncOk(),
    });
    await ops.terminateApp('MY-UDID', 'com.app.test');
    expect(capturedListArgs).toContain('processes');
    expect(capturedListArgs).toContain('--device');
    expect(capturedListArgs).toContain('MY-UDID');
    expect(capturedTerminateArgs).toContain('terminate');
    expect(capturedTerminateArgs).toContain('--pid');
    expect(capturedTerminateArgs).toContain('99');
  });

  it('openDeepLink calls xcrun devicectl device process launch with bundleId', async () => {
    let capturedArgs: string[] = [];
    const ops = createDevicectlOps({
      spawnSync: (_cmd, args) => {
        capturedArgs = args;
        return syncOk();
      },
      spawnAsync: async () => asyncOk(),
    });
    await ops.openDeepLink('MY-UDID', 'com.app.test', 'myapp://profile/1');
    expect(capturedArgs).toContain('process');
    expect(capturedArgs).toContain('launch');
    expect(capturedArgs).toContain('--device');
    expect(capturedArgs).toContain('MY-UDID');
    expect(capturedArgs).toContain('com.app.test');
    expect(capturedArgs).toContain('--args');
    expect(capturedArgs).toContain('myapp://profile/1');
  });
});
