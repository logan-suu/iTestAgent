/**
 * Tests for XcodebuildBuildDriver.
 *
 * All subprocess calls are mocked — no real xcodebuild is invoked.
 *
 * Coverage:
 *   - doctor: xcodebuild available / not available / version parse
 *   - listSchemes: valid JSON → schemes / invalid JSON → error / xcodebuild not found
 *   - showBuildSettings: valid key=value output → settings map
 *   - build: success path / failure path / command arguments / xcbeautify call
 *   - test/archive: verify they throw 'not implemented'
 *   - Error: xcodebuild not on PATH → graceful error
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { BuildDriver } from 'itestagent-contracts';
import type { DevicectlOps } from '../src/devicectl-ops.js';
import type { SigningDiagnostic } from '../src/signing-diagnostics.js';
import { createXcodebuildBuildDriver } from '../src/xcodebuild-build-driver.js';
import type {
  BeautifyFn,
  FindAppPathFn,
  FindProjectFileFn,
  SpawnAsyncFn,
  SpawnSyncFn,
} from '../src/xcodebuild-build-driver.js';

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Create a driver with fully mocked dependencies.
 */
function createMockDriver(opts?: {
  spawnSync?: SpawnSyncFn;
  spawnAsync?: SpawnAsyncFn;
  beautify?: BeautifyFn;
  findProjectFile?: FindProjectFileFn;
  findAppPath?: FindAppPathFn;
  devicectlOps?: DevicectlOps;
  diagnoseSigning?: (output: string) => SigningDiagnostic | null;
}): BuildDriver {
  return createXcodebuildBuildDriver({
    spawnSync: opts?.spawnSync ?? (() => ({ exitCode: 0, stdout: '', stderr: '' })),
    spawnAsync: opts?.spawnAsync ?? (async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    beautify: opts?.beautify ?? (async (s) => s),
    findProjectFile:
      opts?.findProjectFile ??
      ((_root) => ({
        type: 'xcode_project',
        path: '/fake/project/MyApp.xcodeproj',
      })),
    findAppPath: opts?.findAppPath,
    devicectlOps: opts?.devicectlOps,
    diagnoseSigning: opts?.diagnoseSigning,
  });
}

// ─── doctor ───────────────────────────────────────────────────────

describe('doctor', () => {
  it('reports xcodebuild available with version', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'Xcode 16.2\nBuild version 16C5032a', stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.doctor();

    expect(result.xcodeInstalled).toBe(true);
    expect(result.xcodeVersion).toBe('16.2');
    expect(result.issues).toEqual([]);
  });

  it('reports xcodebuild not available', async () => {
    let callIndex = 0;
    const mockSync = (_cmd: string, _args: string[], _cwd?: string) => {
      callIndex++;
      if (callIndex === 1) {
        // xcodebuild -version fails
        return { exitCode: 1, stdout: '', stderr: 'command not found: xcodebuild' };
      }
      // xcrun xcode-select -p also fails
      return { exitCode: 1, stdout: '', stderr: 'command not found: xcrun' };
    };

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.doctor();

    expect(result.xcodeInstalled).toBe(false);
    expect(result.xcodeVersion).toBeUndefined();
    expect(result.commandLineTools).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i: string) => i.includes('xcodebuild'))).toBe(true);
  });

  it('parses Xcode version with three-part version', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'Xcode 15.4.1\nBuild version 15F5031c', stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.doctor();

    expect(result.xcodeVersion).toBe('15.4.1');
  });

  it('checks command line tools availability', async () => {
    let callIndex = 0;
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      callIndex++;
      if (callIndex === 1) {
        return { exitCode: 0, stdout: 'Xcode 16.2\nBuild version 16C5032a', stderr: '' };
      }
      if (callIndex === 2) {
        return { exitCode: 0, stdout: '/Applications/Xcode.app/Contents/Developer', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.doctor();

    expect(result.commandLineTools).toBe(true);
  });

  it('returns signingIdentities as empty array', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.doctor();

    // Signing identities are a stub — deferred to fastlane path
    expect(result.signingIdentities).toEqual([]);
  });
});

// ─── listSchemes ──────────────────────────────────────────────────

describe('listSchemes', () => {
  it('parses valid xcodebuild -list -json output into SchemeInfo[]', async () => {
    const jsonOutput = JSON.stringify({
      project: {
        name: 'MyApp',
        schemes: ['MyApp', 'MyAppTests', 'MyAppUITests'],
        configurations: ['Debug', 'Release'],
        targets: ['MyApp', 'MyAppTests', 'MyAppUITests'],
      },
    });

    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: jsonOutput, stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const schemes = await driver.listSchemes('/fake/project');

    expect(schemes).toHaveLength(3);
    expect(schemes[0]).toEqual({
      name: 'MyApp',
      type: 'app',
      buildConfigurations: ['Debug', 'Release'],
    });
    expect(schemes[1]).toEqual({
      name: 'MyAppTests',
      type: 'test',
      buildConfigurations: ['Debug', 'Release'],
    });
  });

  it('throws when xcodebuild exits with non-zero', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 1, stdout: '', stderr: 'xcodebuild: error: unable to find project' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    await expect(driver.listSchemes('/fake/project')).rejects.toThrow(
      'xcodebuild -list -json failed',
    );
  });

  it('throws when JSON output is invalid', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: '{ not valid json }', stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    await expect(driver.listSchemes('/fake/project')).rejects.toThrow(
      'Failed to parse xcodebuild -list -json output',
    );
  });

  it('classifies scheme ending in .xctest as test type', async () => {
    const jsonOutput = JSON.stringify({
      project: {
        name: 'MyApp',
        schemes: ['MyApp.xctest'],
        configurations: ['Debug'],
        targets: [],
      },
    });

    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: jsonOutput, stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const schemes = await driver.listSchemes('/fake/project');

    expect(schemes[0]?.type).toBe('test');
  });

  it('handles empty schemes list', async () => {
    const jsonOutput = JSON.stringify({
      project: {
        name: 'Empty',
        schemes: [],
        configurations: [],
        targets: [],
      },
    });

    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: jsonOutput, stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const schemes = await driver.listSchemes('/fake/project');

    expect(schemes).toEqual([]);
  });
});

// ─── showBuildSettings ────────────────────────────────────────────

describe('showBuildSettings', () => {
  it('parses key=value output into settings map', async () => {
    const buildSettingsOutput = [
      'ACTION=build',
      'BUILD_DIR=/Users/test/Library/Developer/Xcode/DerivedData/MyApp/Build/Products',
      'BUILT_PRODUCTS_DIR=/Users/test/Library/Developer/Xcode/DerivedData/MyApp/Build/Products/Debug-iphoneos',
      'CONFIGURATION=Debug',
      'PRODUCT_NAME=MyApp',
    ].join('\n');

    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: buildSettingsOutput, stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.showBuildSettings({
      root: '/fake/project',
      scheme: 'MyApp',
    });

    expect(result.settings.ACTION).toBe('build');
    expect(result.settings.BUILD_DIR).toContain('DerivedData');
    expect(result.settings.PRODUCT_NAME).toBe('MyApp');
    expect(result.settings).toHaveProperty('BUILT_PRODUCTS_DIR');
  });

  it('throws on non-zero exit code', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 65, stdout: '', stderr: 'xcodebuild: error: scheme not found' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    await expect(
      driver.showBuildSettings({ root: '/fake/project', scheme: 'NotFound' }),
    ).rejects.toThrow('xcodebuild -showBuildSettings failed');
  });

  it('extracts derivedDataPath and builtProductsDir from settings', async () => {
    const buildSettingsOutput = [
      'BUILD_DIR=/Users/test/DerivedData/MyApp/Build/Products',
      'BUILT_PRODUCTS_DIR=/Users/test/DerivedData/MyApp/Build/Products/Debug-iphoneos',
    ].join('\n');

    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: buildSettingsOutput, stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.showBuildSettings({
      root: '/fake/project',
      scheme: 'MyApp',
      configuration: 'Debug',
    });

    expect(result.derivedDataPath).toContain('DerivedData');
    expect(result.builtProductsDir).toContain('Debug-iphoneos');
  });

  it('handles empty output gracefully', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.showBuildSettings({
      root: '/fake/project',
      scheme: 'MyApp',
    });

    expect(result.settings).toEqual({});
  });
});

// ─── build ────────────────────────────────────────────────────────

describe('build', () => {
  const defaultBuildInput = {
    root: '/fake/project',
    scheme: 'MyApp',
    configuration: 'Debug' as const,
    deviceId: '00008110-001234567890001E',
  };

  it('returns success result on exit code 0', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const mockBeautify = mock(async (raw: string, _cwd?: string) => {
      return `[beautified] ${raw}`;
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: mockBeautify,
    });

    const result = await driver.build(defaultBuildInput);

    expect(result.success).toBe(true);
    expect(result.log).toContain('[beautified]');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns failure result on non-zero exit code', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 65, stdout: '', stderr: 'xcodebuild: error: scheme MyApp not found' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.build(defaultBuildInput);

    expect(result.success).toBe(false);
    expect(result.log).toContain('scheme MyApp not found');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls xcbeautify on build output', async () => {
    const rawOutput = 'Compile MyViewController.swift (in target MyApp)';

    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: rawOutput, stderr: '' };
    });

    let beautifyCalledWith = '';
    const beautifyMock = mock(async (raw: string, _cwd?: string) => {
      beautifyCalledWith = raw;
      return raw;
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: beautifyMock,
    });

    await driver.build(defaultBuildInput);

    expect(beautifyMock).toHaveBeenCalled();
    expect(beautifyCalledWith).toBe(rawOutput);
  });

  it('passes correct arguments to xcodebuild', async () => {
    let capturedArgs: string[] = [];

    const mockAsync = mock(async (_cmd: string, args: string[], _cwd?: string) => {
      capturedArgs = args;
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    await driver.build({
      ...defaultBuildInput,
      derivedDataPath: '/custom/derivedData',
      extraArgs: ['-quiet'],
    });

    // Verify key arguments are present
    const argsStr = capturedArgs.join(' ');
    expect(argsStr).toContain('-scheme MyApp');
    expect(argsStr).toContain('-configuration Debug');
    expect(argsStr).toContain('platform=iOS,id=00008110-001234567890001E');
    expect(argsStr).toContain('-derivedDataPath /custom/derivedData');
    expect(argsStr).toContain('build');
    expect(capturedArgs).toContain('-quiet');
  });

  it('handles Release configuration', async () => {
    let capturedArgs: string[] = [];

    const mockAsync = mock(async (_cmd: string, args: string[], _cwd?: string) => {
      capturedArgs = args;
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    await driver.build({
      ...defaultBuildInput,
      configuration: 'Release',
    });

    const argsStr = capturedArgs.join(' ');
    expect(argsStr).toContain('-configuration Release');
  });

  it('uses default derivedDataPath when not provided', async () => {
    let capturedArgs: string[] = [];

    const mockAsync = mock(async (_cmd: string, args: string[], _cwd?: string) => {
      capturedArgs = args;
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    await driver.build(defaultBuildInput);

    const argsStr = capturedArgs.join(' ');
    expect(argsStr).toContain('-derivedDataPath /fake/project/build/derivedData');
  });

  it('returns failure when no project file is found', async () => {
    const driver = createMockDriver({
      beautify: async (s) => s,
      findProjectFile: () => null,
    });

    const result = await driver.build({
      ...defaultBuildInput,
      root: '/tmp/empty-dir',
    });

    expect(result.success).toBe(false);
    expect(result.log).toContain('No .xcworkspace or .xcodeproj found');
  });

  it('records durationMs', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.build(defaultBuildInput);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });
});

// ─── test ──────────────────────────────────────────────────────────

describe('test', () => {
  const testInput = {
    root: '/fake/project',
    scheme: 'MyAppTests',
    deviceId: '00008110-001234567890001E',
  };

  it('returns success result with parsed test counts on exit 0', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return {
        exitCode: 0,
        stdout:
          '** TEST SUCCEEDED **\nExecuted 5 tests, with 0 failures (0 unexpected) in 2.345 (3.000) seconds',
        stderr: '',
      };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.test(testInput);

    expect(result.success).toBe(true);
    expect(result.totalTests).toBe(5);
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.log).toContain('TEST SUCCEEDED');
  });

  it('returns failure result with failed count on non-zero exit code', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return {
        exitCode: 1,
        stdout:
          '** TEST FAILED **\nExecuted 10 tests, with 3 failures (0 unexpected) in 8.123 (9.000) seconds',
        stderr: '',
      };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.test(testInput);

    expect(result.success).toBe(false);
    expect(result.totalTests).toBe(10);
    expect(result.passed).toBe(7);
    expect(result.failed).toBe(3);
  });

  it('passes correct arguments to xcodebuild test', async () => {
    let capturedArgs: string[] = [];

    const mockAsync = mock(async (_cmd: string, args: string[], _cwd?: string) => {
      capturedArgs = args;
      return {
        exitCode: 0,
        stdout: 'Executed 1 test, with 0 failures',
        stderr: '',
      };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    await driver.test(testInput);

    const argsStr = capturedArgs.join(' ');
    expect(argsStr).toContain('-scheme MyAppTests');
    expect(argsStr).toContain('platform=iOS,id=00008110-001234567890001E');
    expect(argsStr).toContain('-derivedDataPath /fake/project/build/derivedData');
    expect(argsStr).toContain(
      '-resultBundlePath /fake/project/build/derivedData/Logs/Test/Test-MyAppTests.xcresult',
    );
    expect(capturedArgs).toContain('test');
  });

  it('includes -testPlan when provided', async () => {
    let capturedArgs: string[] = [];

    const mockAsync = mock(async (_cmd: string, args: string[], _cwd?: string) => {
      capturedArgs = args;
      return { exitCode: 0, stdout: 'Executed 1 test, with 0 failures', stderr: '' };
    });

    const driver = createMockDriver({ spawnAsync: mockAsync, beautify: async (s) => s });

    await driver.test({ ...testInput, testPlan: 'MyAppTestPlan' });

    const argsStr = capturedArgs.join(' ');
    expect(argsStr).toContain('-testPlan MyAppTestPlan');
  });

  it('includes -only-testing when provided', async () => {
    let capturedArgs: string[] = [];

    const mockAsync = mock(async (_cmd: string, args: string[], _cwd?: string) => {
      capturedArgs = args;
      return { exitCode: 0, stdout: 'Executed 1 test, with 0 failures', stderr: '' };
    });

    const driver = createMockDriver({ spawnAsync: mockAsync, beautify: async (s) => s });

    await driver.test({
      ...testInput,
      only: ['MyAppTests/LoginTests/testLogin', 'MyAppTests/SignupTests/testSignup'],
    });

    expect(capturedArgs.filter((a) => a === '-only-testing')).toHaveLength(2);
    expect(capturedArgs).toContain('MyAppTests/LoginTests/testLogin');
    expect(capturedArgs).toContain('MyAppTests/SignupTests/testSignup');
  });

  it('includes -skip-testing when provided', async () => {
    let capturedArgs: string[] = [];

    const mockAsync = mock(async (_cmd: string, args: string[], _cwd?: string) => {
      capturedArgs = args;
      return { exitCode: 0, stdout: 'Executed 1 test, with 0 failures', stderr: '' };
    });

    const driver = createMockDriver({ spawnAsync: mockAsync, beautify: async (s) => s });

    await driver.test({
      ...testInput,
      skip: ['MyAppTests/SlowTests/testSlow', 'MyAppTests/FlakyTests/testFlaky'],
    });

    expect(capturedArgs.filter((a) => a === '-skip-testing')).toHaveLength(2);
    expect(capturedArgs).toContain('MyAppTests/SlowTests/testSlow');
    expect(capturedArgs).toContain('MyAppTests/FlakyTests/testFlaky');
  });

  it('calls xcbeautify on test output', async () => {
    const rawOutput = 'Test Case MyAppTests started';

    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: rawOutput, stderr: '' };
    });

    let beautifyCalledWith = '';
    const beautifyMock = mock(async (raw: string, _cwd?: string) => {
      beautifyCalledWith = raw;
      return raw;
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: beautifyMock,
    });

    await driver.test(testInput);

    expect(beautifyMock).toHaveBeenCalled();
    expect(beautifyCalledWith).toBe(rawOutput);
  });

  it('returns failure when no project file is found', async () => {
    const driver = createMockDriver({
      beautify: async (s) => s,
      findProjectFile: () => null,
    });

    const result = await driver.test({
      ...testInput,
      root: '/tmp/empty-dir',
    });

    expect(result.success).toBe(false);
    expect(result.totalTests).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.log).toContain('No .xcworkspace or .xcodeproj found');
  });

  it('records durationMs', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'Executed 1 test, with 0 failures', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.test(testInput);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.durationMs)).toBe(true);
  });

  it('omits xcresultPath when file does not exist on disk (R5)', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'Executed 1 test, with 0 failures', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.test(testInput);

    // The xcresult path is /fake/project/build/derivedData/Logs/Test/Test-MyAppTests.xcresult
    // which will not exist in test environment → xcresultPath must be undefined per R5
    expect(result.xcresultPath).toBeUndefined();
  });

  it('handles xcodebuild spawn error gracefully (exitCode -1)', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: -1, stdout: '', stderr: 'command not found: xcodebuild' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.test(testInput);

    expect(result.success).toBe(false);
    expect(result.totalTests).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.xcresultPath).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('parses "1 test" singular form correctly', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return {
        exitCode: 0,
        stdout: 'Executed 1 test, with 1 failure (0 unexpected) in 0.123 seconds',
        stderr: '',
      };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.test(testInput);

    expect(result.totalTests).toBe(1);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
  });
});

// ─── archive (stub) ───────────────────────────────────────────────

describe('archive', () => {
  it('throws not implemented error', async () => {
    const driver = createMockDriver();

    await expect(
      driver.archive({
        root: '/fake/project',
        scheme: 'MyApp',
        outputDir: '/tmp/archives',
      }),
    ).rejects.toThrow('archive() not implemented');
  });
});

// ─── Error handling ───────────────────────────────────────────────

describe('error handling', () => {
  it('handles spawnSync returning exit code -1 (command not found)', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: -1, stdout: '', stderr: 'command not found: xcodebuild' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });

    await expect(driver.listSchemes('/fake/project')).rejects.toThrow();
  });

  it('doctor returns gracefully when xcodebuild is not on PATH', async () => {
    const mockSync = mock((_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: -1, stdout: '', stderr: 'command not found' };
    });

    const driver = createMockDriver({ spawnSync: mockSync });
    const result = await driver.doctor();

    expect(result.xcodeInstalled).toBe(false);
    expect(result.commandLineTools).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

// ─── Integration: Full flow ───────────────────────────────────────

describe('integration', () => {
  it('full happy path: doctor → listSchemes → showBuildSettings → build', async () => {
    let callIndex = 0;
    const mockSync = mock((_cmd: string, args: string[], _cwd?: string) => {
      callIndex++;
      // doctor: xcodebuild -version
      if (args.includes('-version')) {
        return { exitCode: 0, stdout: 'Xcode 16.2\nBuild version 16C5032a', stderr: '' };
      }
      // doctor: xcrun xcode-select -p
      if (args[0] === 'xcode-select') {
        return { exitCode: 0, stdout: '/Applications/Xcode.app/Contents/Developer', stderr: '' };
      }
      // listSchemes: xcodebuild -list -json
      if (args.includes('-list')) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            project: {
              name: 'MyApp',
              schemes: ['MyApp', 'MyAppTests'],
              configurations: ['Debug', 'Release'],
              targets: ['MyApp', 'MyAppTests'],
            },
          }),
          stderr: '',
        };
      }
      // showBuildSettings
      if (args.includes('-showBuildSettings')) {
        return {
          exitCode: 0,
          stdout: 'PRODUCT_NAME=MyApp\nBUILD_DIR=/DerivedData/MyApp/Build/Products',
          stderr: '',
        };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnSync: mockSync,
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    // 1. doctor
    const docResult = await driver.doctor();
    expect(docResult.xcodeInstalled).toBe(true);
    expect(docResult.xcodeVersion).toBe('16.2');

    // 2. listSchemes
    const schemes = await driver.listSchemes('/fake/project');
    expect(schemes).toHaveLength(2);
    expect(schemes[0]?.name).toBe('MyApp');

    // 3. showBuildSettings
    const settings = await driver.showBuildSettings({
      root: '/fake/project',
      scheme: 'MyApp',
    });
    expect(settings.settings.PRODUCT_NAME).toBe('MyApp');

    // 4. build
    const buildResult = await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: '00008110-001234567890001E',
    });
    expect(buildResult.success).toBe(true);
  });
});

// ─── build integration — devicectl install ────────────────────────

describe('build integration — devicectl install', () => {
  it('auto-installs after successful build', async () => {
    let installCalled = false;
    let capturedUdid = '';
    let capturedAppPath = '';

    const mockDevicectlOps: DevicectlOps = {
      installApp: async (udid, appPath) => {
        installCalled = true;
        capturedUdid = udid;
        capturedAppPath = appPath;
        return { success: true };
      },
      launchApp: async () => ({ success: true }),
      terminateApp: async () => ({ success: true }),
      openDeepLink: async (_udid, _bundleId, _url) => ({ success: true }),
    };

    const mockFindApp: FindAppPathFn = () => '/fake/DerivedData/Debug-iphoneos/MyApp.app';

    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
      devicectlOps: mockDevicectlOps,
      findAppPath: mockFindApp,
    });

    const result = await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: 'DEVICE-UDID-123',
    });

    expect(result.success).toBe(true);
    expect(installCalled).toBe(true);
    expect(capturedUdid).toBe('DEVICE-UDID-123');
    expect(capturedAppPath).toBe('/fake/DerivedData/Debug-iphoneos/MyApp.app');
  });

  it('returns installed=false when install fails', async () => {
    const mockDevicectlOps: DevicectlOps = {
      installApp: async () => ({
        success: false,
        error: 'devicectl install failed: device locked',
      }),
      launchApp: async () => ({ success: true }),
      terminateApp: async () => ({ success: true }),
      openDeepLink: async (_udid, _bundleId, _url) => ({ success: true }),
    };

    const mockFindApp: FindAppPathFn = () => '/fake/apps/MyApp.app';

    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
      devicectlOps: mockDevicectlOps,
      findAppPath: mockFindApp,
    });

    const result = await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: 'DEVICE-UDID',
    });

    expect(result.success).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.installError).toContain('device locked');
  });

  it('does not install when appPath not found', async () => {
    let installCalled = false;

    const mockDevicectlOps: DevicectlOps = {
      installApp: async () => {
        installCalled = true;
        return { success: true };
      },
      launchApp: async () => ({ success: true }),
      terminateApp: async () => ({ success: true }),
      openDeepLink: async (_udid, _bundleId, _url) => ({ success: true }),
    };

    const mockFindApp: FindAppPathFn = () => undefined;

    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
      devicectlOps: mockDevicectlOps,
      findAppPath: mockFindApp,
    });

    const result = await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: 'DEVICE-UDID',
    });

    expect(result.success).toBe(true);
    expect(installCalled).toBe(false);
  });
});

// ─── build integration — signing diagnostics ──────────────────────

describe('build integration — signing diagnostics', () => {
  it('includes SIGNING DIAGNOSTIC in log when provisioning profile missing', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return {
        exitCode: 65,
        stdout: '',
        stderr: 'error: No provisioning profile found for bundle identifier com.example.MyApp',
      };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: 'DEVICE-UDID',
    });

    expect(result.success).toBe(false);
    expect(result.log).toContain('SIGNING DIAGNOSTIC');
    expect(result.log).toContain('provisioning profile');
  });

  it('includes fix guidance when signing certificate missing', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return {
        exitCode: 65,
        stdout: '',
        stderr: 'error: No signing certificate for "iPhone Developer" found',
      };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: 'DEVICE-UDID',
    });

    expect(result.success).toBe(false);
    expect(result.log).toContain('SIGNING DIAGNOSTIC');
    expect(result.log).toContain('Fix guidance');
  });

  it('returns raw log without diagnostic for non-signing errors', async () => {
    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'clang: error: linker command failed with exit code 1',
      };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
    });

    const result = await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: 'DEVICE-UDID',
    });

    expect(result.success).toBe(false);
    expect(result.log).not.toContain('SIGNING DIAGNOSTIC');
  });
});

// ─── build integration — injected deps ────────────────────────────

describe('build integration — injected deps', () => {
  it('devicectlOps.installApp receives correct udid and appPath', async () => {
    let capturedUdid = '';
    let capturedAppPath = '';

    const mockDevicectlOps: DevicectlOps = {
      installApp: async (udid, appPath) => {
        capturedUdid = udid;
        capturedAppPath = appPath;
        return { success: true };
      },
      launchApp: async () => ({ success: true }),
      terminateApp: async () => ({ success: true }),
      openDeepLink: async (_udid, _bundleId, _url) => ({ success: true }),
    };

    const mockFindApp: FindAppPathFn = () => '/apps/MyApp.app';

    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return { exitCode: 0, stdout: 'BUILD SUCCEEDED', stderr: '' };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
      devicectlOps: mockDevicectlOps,
      findAppPath: mockFindApp,
    });

    await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: 'ABCD-1234-EFGH',
    });

    expect(capturedUdid).toBe('ABCD-1234-EFGH');
    expect(capturedAppPath).toBe('/apps/MyApp.app');
  });

  it('diagnoseSigning is called with raw output on build failure', async () => {
    let receivedOutput = '';
    const mockDiagnose = (output: string): SigningDiagnostic | null => {
      receivedOutput = output;
      return null;
    };

    const mockAsync = mock(async (_cmd: string, _args: string[], _cwd?: string) => {
      return {
        exitCode: 1,
        stdout: 'CompileSwift',
        stderr: 'error: something went wrong',
      };
    });

    const driver = createMockDriver({
      spawnAsync: mockAsync,
      beautify: async (s) => s,
      diagnoseSigning: mockDiagnose,
    });

    await driver.build({
      root: '/fake/project',
      scheme: 'MyApp',
      deviceId: 'DEVICE-UDID',
    });

    expect(receivedOutput).toContain('CompileSwift');
    expect(receivedOutput).toContain('error: something went wrong');
  });
});
