/**
 * Owned process group — reaping.
 *
 * Reaping wires Bun's raw child exit into the group's ExitInfo record:
 * the moment the OS reports the exit, cleanup deadlines are released and
 * the exit code / terminating signal is decoded into the shared ExitInfo.
 *
 * Moved verbatim from the `subprocess.exited.then(...)` wiring of
 * itestagent-server/src/subprocess-controller.ts (B06, ADR-023).
 */

import type { Subprocess } from 'bun';
import { decodeRawExitCode } from './owned-process-group-system.js';
import type { ExitInfo } from './subprocess-types.js';

/**
 * Reap an owned child process: resolve when it exits, release cleanup
 * deadlines via `onSettled`, decode the raw exit code into `exitInfo`
 * (mutated in place) and resolve with that same record.
 */
export function reapOwnedProcess(
  subprocess: Subprocess,
  exitInfo: ExitInfo,
  onSettled: () => void,
): Promise<ExitInfo> {
  return subprocess.exited.then((rawCode: number) => {
    onSettled();

    const decoded = decodeRawExitCode(rawCode);
    exitInfo.exitCode = decoded.exitCode;
    exitInfo.signal = decoded.signal;
    return exitInfo;
  });
}
