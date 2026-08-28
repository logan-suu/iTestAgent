/**
 * physical-build-artifact.test.ts — B12 physical build flow coverage
 * (promotion guide §11.3 "build-xcodebuild", ADR-012 Route C semantics).
 *
 * buildForPhysical runs `xcodebuild build` against a physical destination,
 * passes -allowProvisioningUpdates when free-account provisioning is enabled
 * (the Route C core breakthrough), and resolves the .app artifact through a
 * follow-up `-showBuildSettings` query.
 */
import { describe, expect, it } from 'bun:test';
import { buildForPhysical } from '../src/physical-build.js';
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

const SETTINGS_STDOUT =
  'Information about project "Fixture"\n    TARGET_BUILD_DIR = /fixture/DerivedData/Build/Products/Debug-iphoneos\n    FULL_PRODUCT_NAME = Fixture.app\n';

describe('buildForPhysical', () => {
  it('targets the injected UDID and enables provisioning updates (Route C)', async () => {
    const { runner, calls } = makeScriptedRunner((call) => {
      if (call.args[0] === 'build') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: SETTINGS_STDOUT, stderr: '' };
    });

    const result = await buildForPhysical(
      {
        projectRoot: '/fixture/project',
        scheme: 'FixtureScheme',
        udid: 'UDID-FIXTURE-00000000000000000001',
        allowProvisioningUpdates: true,
      },
      runner,
    );

    expect(result.exitCode).toBe(0);
    expect(result.appPath).toBe('/fixture/DerivedData/Build/Products/Debug-iphoneos/Fixture.app');

    const buildCall = calls.find((c) => c.args[0] === 'build');
    if (!buildCall) throw new Error('expected a build call');
    const destIndex = buildCall.args.indexOf('-destination');
    expect(buildCall.args[destIndex + 1]).toBe('platform=iOS,id=UDID-FIXTURE-00000000000000000001');
    // Route C: free-account provisioning requires this explicit flag.
    expect(buildCall.args).toContain('-allowProvisioningUpdates');
  });

  it('omits the provisioning flag when not requested', async () => {
    const { runner, calls } = makeScriptedRunner((call) => {
      if (call.args[0] === 'build') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: SETTINGS_STDOUT, stderr: '' };
    });

    await buildForPhysical(
      { projectRoot: '/fixture/project', scheme: 'FixtureScheme', udid: 'UDID-FIXTURE-X' },
      runner,
    );
    const buildCall = calls.find((c) => c.args[0] === 'build');
    if (!buildCall) throw new Error('expected a build call');
    expect(buildCall.args).not.toContain('-allowProvisioningUpdates');
  });

  it('uses the generic physical destination without a UDID', async () => {
    const { runner, calls } = makeScriptedRunner((call) => {
      if (call.args[0] === 'build') return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: SETTINGS_STDOUT, stderr: '' };
    });

    const result = await buildForPhysical(
      { projectRoot: '/fixture/project', scheme: 'FixtureScheme' },
      runner,
    );
    expect(result.exitCode).toBe(0);
    const buildCall = calls.find((c) => c.args[0] === 'build');
    if (!buildCall) throw new Error('expected a build call');
    const destIndex = buildCall.args.indexOf('-destination');
    expect(buildCall.args[destIndex + 1]).toBe('generic/platform=iOS');
  });
});
