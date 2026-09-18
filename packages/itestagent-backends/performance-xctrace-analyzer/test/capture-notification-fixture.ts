import type { startCaptureProcess } from '../src/capture-process.js';
import { createProductionPerformanceCapture } from '../src/production-capture.js';

/** Only the OS notification transport is faked; the readiness state machine is real. */
export function createFixtureCapture(
  spawn: typeof startCaptureProcess,
  clock?: Parameters<typeof createProductionPerformanceCapture>[1],
) {
  let notify: (() => void) | undefined;
  return createProductionPerformanceCapture((command, options) => {
    if (command[0] === '/usr/bin/notifyutil') {
      const key = command[2];
      const probe = command[4];
      let resolve!: (value: Awaited<ReturnType<typeof startCaptureProcess>['completed']>) => void;
      const completed = new Promise<Awaited<ReturnType<typeof startCaptureProcess>['completed']>>(
        (done) => {
          resolve = done;
        },
      );
      queueMicrotask(() => options.onOutput?.(`${probe}\n`));
      notify = () =>
        resolve({ stdout: `${probe}\n${key}\n`, stderr: '', exitCode: 0, failure: undefined });
      return {
        completed,
        stop() {},
        cancel: () =>
          resolve({ stdout: '', stderr: '', exitCode: 143, failure: 'performance.cancelled' }),
      };
    }
    const child = spawn(command, options);
    if (command.includes('record')) queueMicrotask(() => notify?.());
    return child;
  }, clock);
}
