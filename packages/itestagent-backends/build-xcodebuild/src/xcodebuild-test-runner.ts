/**
 * Xcodebuild test runner — B12 module split (promotion guide §11.3
 * "build-xcodebuild").
 *
 * Wraps `xcodebuild test` with the contracts-layer destination vocabulary
 * (B04 BuildDestination) and `-only-testing` filter mapping; execution goes
 * through the injectable process runner with the project root as cwd.
 */
import type { BuildDestination } from 'itestagent-contracts';
import { destinationArgs } from './xcodebuild-driver-support.js';
import type { XcodebuildProcessRunner } from './xcodebuild-process-types.js';

export interface XcodebuildTestRunInput {
  /** Project/workspace directory passed as the child process cwd. */
  projectRoot: string;
  scheme: string;
  testPlan?: string;
  /** Permit Xcode-managed signing updates after an explicit high-risk confirmation. */
  allowProvisioningUpdates?: boolean;
  destination?: BuildDestination;
  /** Test identifiers filtered as `-only-testing:<target>[/suite[/case]]`. */
  only?: string[];
  extraArgs?: string[];
  signal?: AbortSignal;
}

export interface XcodebuildTestRunOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Runs `xcodebuild test` for the given scheme and filters.
 */
export async function runXcodebuildTests(
  input: XcodebuildTestRunInput,
  runner: XcodebuildProcessRunner,
): Promise<XcodebuildTestRunOutput> {
  const args = ['test', '-scheme', input.scheme, ...destinationArgs(input.destination)];
  if (input.testPlan) args.push('-testPlan', input.testPlan);
  if (input.allowProvisioningUpdates) args.push('-allowProvisioningUpdates');
  for (const item of input.only ?? []) {
    args.push(`-only-testing:${item}`);
  }
  args.push(...(input.extraArgs ?? []));

  const start = Date.now();
  const result = await runner('xcodebuild', args, {
    cwd: input.projectRoot,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return { ...result, durationMs: Date.now() - start };
}
