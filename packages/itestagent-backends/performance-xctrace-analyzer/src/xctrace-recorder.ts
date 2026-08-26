/**
 * Trace recording wrapper — B21 module split (promotion guide §11.3 "generic
 * xctrace mechanics").
 *
 * Thin, product-neutral wrapper around the pinned `xcrun xctrace record`
 * invocation (AGENTS.md R2: wraps the official CLI). The process runner is
 * injected so tests lock the argument sequence without real recordings.
 */

/** Runner contract for one completed external process invocation. */
export type XctraceProcessRunner = (
  cmd: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** Recording templates supported by the generic wrapper. */
export type XctraceRecordTemplate = 'cpu' | 'hangs' | 'memory' | 'launch' | 'all';

export interface XctraceRecordOptions {
  /** Target-explicit device identifier — never guessed. */
  deviceId: string;
  template: XctraceRecordTemplate;
  /** Optional recording time limit in seconds (--time-limit <N>s). */
  durationSeconds?: number;
  /** Output .trace path passed verbatim to xctrace --output. */
  outputTracePath: string;
}

export interface XctraceRecorderDeps {
  runner: XctraceProcessRunner;
  /** Pinned binary path; defaults to `xcrun` (never PATH-resolved here). */
  recorderPath?: string;
}

/**
 * Creates a recorder that issues the pinned argument sequence:
 *   <recorder> xctrace record --template <t> --device <id> [--time-limit Ns] --output <path>
 */
export function createXctraceRecorder(deps: XctraceRecorderDeps): {
  record(options: XctraceRecordOptions): Promise<{ exitCode: number; tracePath: string }>;
} {
  const recorderPath = deps.recorderPath ?? 'xcrun';

  return {
    async record(options: XctraceRecordOptions): Promise<{ exitCode: number; tracePath: string }> {
      const args = [
        'xctrace',
        'record',
        '--template',
        options.template,
        '--device',
        options.deviceId,
        '--output',
        options.outputTracePath,
      ];
      if (options.durationSeconds !== undefined) {
        args.push('--time-limit', `${options.durationSeconds}s`);
      }
      const result = await deps.runner(recorderPath, args);
      return { exitCode: result.exitCode, tracePath: options.outputTracePath };
    },
  };
}
