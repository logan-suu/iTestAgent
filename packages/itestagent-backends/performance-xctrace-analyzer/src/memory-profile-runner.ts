/**
 * Memory profile recording runner — B22 module split (promotion guide §11.3
 * "parameterized memory profile").
 *
 * Composes the B21 xctrace recorder with injected process I/O so the record
 * call can be locked in tests without real traces. The recorder exit code is
 * carried through verbatim (R5 — a failed recording is never reported as
 * success).
 */

export type MemoryProfileRecorderRunner = (
  cmd: string,
  args: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface MemoryProfileRecordOptions {
  deviceId: string;
  rounds: number;
  outputTracePath?: string;
}

export interface MemoryProfileRecordResult {
  exitCode: number;
  tracePath?: string;
}

export interface MemoryProfileRunnerDeps {
  recorderRunner: MemoryProfileRecorderRunner;
  recorderPath?: string;
}

export function createMemoryProfileRunner(deps: MemoryProfileRunnerDeps): {
  record(options: MemoryProfileRecordOptions): Promise<MemoryProfileRecordResult>;
} {
  return {
    async record(options: MemoryProfileRecordOptions): Promise<MemoryProfileRecordResult> {
      const outputTracePath = options.outputTracePath ?? `/tmp/memory-profile-${Date.now()}.trace`;
      const args = [
        'xctrace',
        'record',
        '--template',
        'memory',
        '--device',
        options.deviceId,
        '--output',
        outputTracePath,
      ];
      const result = await deps.recorderRunner(deps.recorderPath ?? 'xcrun', args);
      return { exitCode: result.exitCode, tracePath: outputTracePath };
    },
  };
}
