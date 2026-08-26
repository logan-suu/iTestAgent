/**
 * memory-profile-runner.test.ts — B22 memory-profile recording pipeline
 * (promotion guide §11.3 "parameterized memory profile").
 *
 * The runner composes the B21 xctrace recorder with injected process I/O so
 * tests lock the record call without real traces.
 */
import { describe, expect, it } from 'bun:test';
import { createMemoryProfileRunner } from '../src/memory-profile-runner.js';

describe('createMemoryProfileRunner', () => {
  it('records a trace through the injected recorder', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runner = createMemoryProfileRunner({
      recorderRunner: async (cmd: string, args: string[]) => {
        calls.push({ cmd, args });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const result = await runner.record({ deviceId: 'DEV-FIXTURE', rounds: 1 });
    expect(result.exitCode).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('propagates a non-zero recorder exit', async () => {
    const runner = createMemoryProfileRunner({
      recorderRunner: async () => ({ exitCode: 65, stdout: '', stderr: 'recording failed' }),
    });
    const result = await runner.record({ deviceId: 'DEV-FIXTURE', rounds: 1 });
    expect(result.exitCode).toBe(65);
  });
});
