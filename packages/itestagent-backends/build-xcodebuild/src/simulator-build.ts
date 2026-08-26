/**
 * Simulator build flow — B12 module split (promotion guide §11.3
 * "build-xcodebuild").
 *
 * Runs `xcodebuild build` against a simulator destination and resolves the
 * built .app artifact through a follow-up `-showBuildSettings` query
 * (TARGET_BUILD_DIR + FULL_PRODUCT_NAME). A non-zero build exits early — the
 * settings query never runs against a failed build.
 */
import { join } from 'node:path';
import { destinationArgs } from './xcodebuild-driver-support.js';
import type { XcodebuildProcessRunner } from './xcodebuild-process-types.js';

export interface SimulatorBuildInput {
  projectRoot: string;
  scheme: string;
  configuration?: string;
  /** Named booted/target simulator (target-explicit; never guessed). */
  simulatorName?: string;
  derivedDataPath?: string;
}

export interface SimulatorBuildOutput {
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

async function queryBuildSettings(
  input: { projectRoot: string; scheme: string },
  runner: XcodebuildProcessRunner,
): Promise<string> {
  const result = await runner('xcodebuild', ['-showBuildSettings', '-scheme', input.scheme], {
    cwd: input.projectRoot,
  });
  return `${result.stdout}\n${result.stderr}`;
}

/**
 * Builds the scheme for the simulator runtime and resolves the .app path.
 */
export async function buildForSimulator(
  input: SimulatorBuildInput,
  runner: XcodebuildProcessRunner,
): Promise<SimulatorBuildOutput> {
  const dest = destinationArgs(
    input.simulatorName
      ? { targetKind: 'simulator', simulatorName: input.simulatorName }
      : { targetKind: 'simulator' },
  );
  const buildArgs = ['build', '-scheme', input.scheme, ...dest];
  if (input.derivedDataPath) buildArgs.push('-derivedDataPath', input.derivedDataPath);

  const build = await runner('xcodebuild', buildArgs, { cwd: input.projectRoot });
  if (build.exitCode !== 0) {
    return { exitCode: build.exitCode, log: `${build.stdout}\n${build.stderr}` };
  }

  const settings = await queryBuildSettings(input, runner);
  const appPath = resolveAppArtifact(settings);
  return { exitCode: 0, appPath, log: `${build.stdout}\n${build.stderr}` };
}
