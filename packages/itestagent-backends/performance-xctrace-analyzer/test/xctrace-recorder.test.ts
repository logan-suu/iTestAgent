/**
 * xctrace-recorder.test.ts — B21 trace recording wrapper (promotion guide
 * §11.3 "generic xctrace mechanics").
 *
 * Locks the pinned `xcrun xctrace record` argument sequence and the optional
 * --time-limit handling; the runner is injected so no real recording runs.
 */
import { describe, expect, it } from 'bun:test';
import { createXctraceRecorder } from '../src/xctrace-recorder.js';

function makeRecordingRunner() {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const runner = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
}

describe('createXctraceRecorder', () => {
  it('issues the pinned record argument sequence', async () => {
    const { runner, calls } = makeRecordingRunner();
    const recorder = createXctraceRecorder({ runner });

    const result = await recorder.record({
      deviceId: 'DEVICE-FIXTURE',
      template: 'memory',
      outputTracePath: '/fixture/trace.trace',
    });

    expect(calls[0]?.cmd).toBe('xcrun');
    expect(calls[0]?.args).toEqual([
      'xctrace',
      'record',
      '--template',
      'memory',
      '--device',
      'DEVICE-FIXTURE',
      '--output',
      '/fixture/trace.trace',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.tracePath).toBe('/fixture/trace.trace');
  });

  it('appends --time-limit when a duration is provided', async () => {
    const { runner, calls } = makeRecordingRunner();
    const recorder = createXctraceRecorder({ runner });

    await recorder.record({
      deviceId: 'DEVICE-FIXTURE',
      template: 'all',
      durationSeconds: 10,
      outputTracePath: '/fixture/timed.trace',
    });

    expect(calls[0]?.args.slice(-2)).toEqual(['--time-limit', '10s']);
  });
});
