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

function successResult(): ReturnType<SpawnSyncFn> {
  return { exitCode: 0, stdout: '', stderr: '' };
}

function errorResult(stderr: string, exitCode = 1): ReturnType<SpawnSyncFn> {
  return { exitCode, stdout: '', stderr };
}

function noopAsync(): SpawnAsyncFn {
  return async () => ({ exitCode: 0, stdout: '', stderr: '' });
}

// ─── installApp ───────────────────────────────────────────────────

describe('installApp', () => {
  it('installs successfully', async () => {
    const spawnSync: SpawnSyncFn = () => successResult();
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.installApp('UDID-123', '/path/to/MyApp.app');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error when device not found', async () => {
    const spawnSync: SpawnSyncFn = () => errorResult('device not found in available devices');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.installApp('UDID-404', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('device "UDID-404" not found');
    expect(result.exitCode).toBe(1);
  });

  it('returns error when device untrusted', async () => {
    const spawnSync: SpawnSyncFn = () => errorResult('The device is not trusted for development');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not trusted');
    expect(result.error).toContain('Trust This Computer');
  });

  it('returns error when developer mode off', async () => {
    const spawnSync: SpawnSyncFn = () => errorResult('developer_mode disabled on this device');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Developer Mode');
  });

  it('returns error when device is locked', async () => {
    const spawnSync: SpawnSyncFn = () => errorResult('The device is locked with a passcode');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('locked');
    expect(result.error).toContain('Unlock');
  });

  it('returns generic error with stderr', async () => {
    const spawnSync: SpawnSyncFn = () => errorResult('some unknown installation failure occurred');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('devicectl install failed');
    expect(result.stderr).toContain('some unknown');
  });

  it('returns generic error when stderr is empty', async () => {
    const spawnSync: SpawnSyncFn = () => ({ exitCode: 1, stdout: '', stderr: '' });
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.installApp('UDID-123', '/path/to/app.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('devicectl install failed');
  });
});

// ─── launchApp ────────────────────────────────────────────────────

describe('launchApp', () => {
  it('launches successfully', async () => {
    const spawnSync: SpawnSyncFn = () => successResult();
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.launchApp('UDID-123', 'com.example.app');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error when app not installed', async () => {
    const spawnSync: SpawnSyncFn = () =>
      errorResult('no such app with bundle identifier com.example.app');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.launchApp('UDID-123', 'com.example.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('app not found');
  });

  it('returns error when already running', async () => {
    const spawnSync: SpawnSyncFn = () => errorResult('process is already running');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.launchApp('UDID-123', 'com.example.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('already running');
  });

  it('passes launch arguments when provided', async () => {
    let capturedArgs: string[] = [];
    const spawnSync: SpawnSyncFn = (_cmd, args) => {
      capturedArgs = args;
      return successResult();
    };
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    await ops.launchApp('UDID-123', 'com.example.app', ['-debug', '--reset']);
    expect(capturedArgs).toContain('--terminate-existing');
    expect(capturedArgs).toContain('--args');
    expect(capturedArgs).toContain('-debug');
    expect(capturedArgs).toContain('--reset');
  });
});

// ─── terminateApp ─────────────────────────────────────────────────

describe('terminateApp', () => {
  it('terminates successfully', async () => {
    const spawnSync: SpawnSyncFn = () => successResult();
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.terminateApp('UDID-123', 'com.example.app');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error when app not found', async () => {
    const spawnSync: SpawnSyncFn = () =>
      errorResult('no such app with bundle identifier com.missing.app');
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.terminateApp('UDID-123', 'com.missing.app');
    expect(result.success).toBe(false);
    expect(result.error).toContain('app not found');
  });
});

// ─── openDeepLink ─────────────────────────────────────────────────

describe('openDeepLink', () => {
  it('opens deep link successfully', async () => {
    const spawnSync: SpawnSyncFn = () => successResult();
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.openDeepLink('UDID-123', 'myapp://profile/123');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error when xcrun not found', async () => {
    let firstCall = true;
    const spawnSync: SpawnSyncFn = () => {
      if (firstCall) {
        firstCall = false;
        return { exitCode: -1, stdout: '', stderr: 'command not found: xcrun' };
      }
      return successResult();
    };
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    const result = await ops.openDeepLink('UDID-123', 'myapp://test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('command not found');
  });
});

// ─── Command argument verification ────────────────────────────────

describe('command arguments', () => {
  it('installApp calls xcrun devicectl device install app', async () => {
    let capturedArgs: string[] = [];
    const spawnSync: SpawnSyncFn = (_cmd, args) => {
      capturedArgs = args;
      return successResult();
    };
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
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
    const spawnSync: SpawnSyncFn = (_cmd, args) => {
      capturedArgs = args;
      return successResult();
    };
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    await ops.launchApp('MY-UDID', 'com.app.test');

    expect(capturedArgs).toContain('process');
    expect(capturedArgs).toContain('launch');
    expect(capturedArgs).toContain('--device');
    expect(capturedArgs).toContain('MY-UDID');
    expect(capturedArgs).toContain('com.app.test');
  });

  it('terminateApp calls xcrun devicectl device process terminate', async () => {
    let capturedArgs: string[] = [];
    const spawnSync: SpawnSyncFn = (_cmd, args) => {
      capturedArgs = args;
      return successResult();
    };
    const ops = createDevicectlOps({ spawnSync, spawnAsync: noopAsync() });
    await ops.terminateApp('MY-UDID', 'com.app.test');

    expect(capturedArgs).toContain('process');
    expect(capturedArgs).toContain('terminate');
    expect(capturedArgs).toContain('--device');
    expect(capturedArgs).toContain('MY-UDID');
    expect(capturedArgs).toContain('com.app.test');
  });
});
