/**
 * Physical device build flow — B12 module split (promotion guide §11.3
 * "build-xcodebuild", ADR-012 Route C).
 *
 * Runs `xcodebuild build` against a physical destination. Free-account
 * provisioning (the Route C core breakthrough) requires the explicit
 * `-allowProvisioningUpdates` flag, passed only when the caller opts in.
 * The built .app artifact is resolved through a follow-up
 * `-showBuildSettings` query; a failed build never triggers that query.
 */
import { join } from 'node:path';
import { destinationArgs } from './xcodebuild-driver-support.js';
import type { XcodebuildProcessRunner } from './xcodebuild-process-types.js';

export interface PhysicalBuildInput {
  projectRoot: string;
  scheme: string;
  configuration?: string;
  /** Target-explicit device UDID; omitted builds for generic/platform=iOS. */
  udid?: string;
  /** Route C: pass -allowProvisioningUpdates to xcodebuild. */
  allowProvisioningUpdates?: boolean;
  derivedDataPath?: string;
}

export interface PhysicalBuildOutput {
  exitCode: number;
  appPath?: string;
  log: string;
}

function resolveAppArtifact(settingsStdout: string): string | undefined {
  const targetBuildDir = /TARGET_BUILD_DIR = (.+)/.exec(settingsStdout)?.[1]?.trim();
  const fullProductName = /FULL_PRODUCT_NAME = (.+)/.exec(settingsStdout)?.[1]?.trim();
  if (!targetBuildDir || !fullProductName) return undefined;
  return join(targetBuildDir, fullProductName);
}

/**
 * Builds the scheme for a physical device and resolves the .app path.
 */
export async function buildForPhysical(
  input: PhysicalBuildInput,
  runner: XcodebuildProcessRunner,
): Promise<PhysicalBuildOutput> {
  const dest = destinationArgs(
    input.udid ? { targetKind: 'physical', udid: input.udid } : { targetKind: 'physical' },
  );
  const buildArgs = ['build', '-scheme', input.scheme, ...dest];
  if (input.allowProvisioningUpdates) buildArgs.push('-allowProvisioningUpdates');
  if (input.derivedDataPath) buildArgs.push('-derivedDataPath', input.derivedDataPath);

  const build = await runner('xcodebuild', buildArgs, { cwd: input.projectRoot });
  if (build.exitCode !== 0) {
    return { exitCode: build.exitCode, log: `${build.stdout}\n${build.stderr}` };
  }

  const settings = await runner('xcodebuild', ['-showBuildSettings', '-scheme', input.scheme], {
    cwd: input.projectRoot,
  });
  const appPath = resolveAppArtifact(`${settings.stdout}\n${settings.stderr}`);
  return { exitCode: 0, appPath, log: `${build.stdout}\n${build.stderr}` };
}
