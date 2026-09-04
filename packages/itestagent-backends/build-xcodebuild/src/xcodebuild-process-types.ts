/**
 * Shared process-runner types — B12 module split (promotion guide §11.3
 * "build-xcodebuild"). The ops modules (simctl-ops, devicectl-ops,
 * xcodebuild-test-runner, simulator/physical builds) all execute external
 * tools through an injectable runner so tests can script tool behavior.
 */

/** Result of one completed external process invocation. */
export interface XcodebuildProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Options forwarded to the underlying spawn implementation. */
export interface XcodebuildProcessOptions {
  /** Kill the process after this many milliseconds. */
  timeoutMs?: number;
  /** Working directory for the child process. */
  cwd?: string;
  /** Cancel the owned child process. */
  signal?: AbortSignal;
}

/**
 * Injectable async process runner.
 * Never PATH-resolves pinned binaries on the caller's behalf — command
 * paths are passed in explicitly by each ops module.
 */
export type XcodebuildProcessRunner = (
  cmd: string,
  args: string[],
  options?: XcodebuildProcessOptions,
) => Promise<XcodebuildProcessResult>;
