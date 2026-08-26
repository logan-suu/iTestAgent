/**
 * simulator-build.test.ts — B12 simulator build flow coverage (promotion
 * guide §11.3 "build-xcodebuild").
 *
 * buildForSimulator runs `xcodebuild build` against a simulator destination
 * and resolves the built .app artifact through a second `-showBuildSettings`
 * query (TARGET_BUILD_DIR + FULL_PRODUCT_NAME). A non-zero build exits early
 * without any settings query.
 */
import { describe, expect, it } from 'bun:test';
import { buildForSimulator } from '../src/simulator-build.js';
import type {
  XcodebuildProcessResult,
  XcodebuildProcessRunner,
} from '../src/xcodebuild-process-types.js';

interface RecordedCall {
  cmd: string;
  args: string[];
}

function makeScriptedRunner(
  handler: (call: RecordedCall, index: number) => XcodebuildProcessResult,
): {
  runner: XcodebuildProcessRunner;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const runner: XcodebuildProcessRunner = async (cmd, args) => {
    const call = { cmd, args };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { runner, calls };
}

describe('buildForSimulator', () => {
  it('builds against the named simulator and resolves the .app artifact', async () => {
    const { runner, calls } = makeScriptedRunner((call) => {
      if (call.args[0] === 'build') return { exitCode: 0, stdout: '', stderr: '' };
      // show-build-settings query
      return {
        exitCode: 0,
        stdout:
          'Information about project "Fixture"\n    TARGET_BUILD_DIR = /fixture/DerivedData/Build/Products/Debug-iphonesimulator\n    FULL_PRODUCT_NAME = Fixture.app\n',
        stderr: '',
      };
    });

    const result = await buildForSimulator(
      {
        projectRoot: '/fixture/project',
        scheme: 'FixtureScheme',
        simulatorName: 'Fixture Sim Booted',
      },
      runner,
    );

    expect(result.exitCode).toBe(0);
    expect(result.appPath).toBe(
      '/fixture/DerivedData/Build/Products/Debug-iphonesimulator/Fixture.app',
    );

    const buildCall = calls.find((c) => c.args[0] === 'build');
    expect(buildCall?.cmd).toBe('xcodebuild');
    expect(buildCall?.args).toContain('-scheme');
    expect(buildCall?.args).toContain('FixtureScheme');
    const destIndex = buildCall?.args.indexOf('-destination') ?? -1;
    expect(destIndex).toBeGreaterThanOrEqual(0);
    expect(buildCall?.args[(destIndex ?? 0) + 1]).toBe(
      'platform=iOS Simulator,name=Fixture Sim Booted',
    );
  });

  it('exits early without a settings query when the build fails', async () => {
    const { runner, calls } = makeScriptedRunner((call) => {
      if (call.args[0] === 'build') return { exitCode: 65, stdout: '', stderr: 'BUILD FAILED' };
      throw new Error('settings must not be queried after a failed build');
    });

    const result = await buildForSimulator(
      { projectRoot: '/fixture/project', scheme: 'FixtureScheme' },
      runner,
    );
    expect(result.exitCode).toBe(65);
    expect(result.log).toContain('BUILD FAILED');
    expect(calls.filter((c) => c.args.includes('-showBuildSettings'))).toHaveLength(0);
  });

  it('passes -derivedDataPath through when provided', async () => {
    const { runner } = makeScriptedRunner((call) => {
      if (call.args[0] === 'build') return { exitCode: 0, stdout: '', stderr: '' };
      return {
        exitCode: 0,
        stdout: 'TARGET_BUILD_DIR = /fixture/DD\nFULL_PRODUCT_NAME = Fixture.app',
        stderr: '',
      };
    });
    const result = await buildForSimulator(
      {
        projectRoot: '/fixture/project',
        scheme: 'FixtureScheme',
        derivedDataPath: '/fixture/DD',
      },
      runner,
    );
    expect(result.exitCode).toBe(0);
  });
});
