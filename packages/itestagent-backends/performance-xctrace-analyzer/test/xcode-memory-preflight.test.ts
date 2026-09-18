import { describe, expect, test } from 'bun:test';
import { startCaptureProcess } from '../src/capture-process.js';
import {
  type XcodeMemoryPreflightInput,
  preflightXcodeMemory,
} from '../src/xcode-memory-preflight.js';

const input: XcodeMemoryPreflightInput = {
  helperPath: '/tmp/itestagent-helper',
  xcodePath: '/Applications/Xcode.app',
  target: { kind: 'physical', deviceId: 'fixture-device', bundleId: 'com.example.fixture' },
};
const valid = {
  protocolVersion: 1,
  status: 'eligible',
  reason: 'xcode_not_running',
  targetVerified: false,
  xcodeVersion: '26.5',
};
const run = (stdout: string, overrides = {}) =>
  preflightXcodeMemory(input, {
    platform: 'darwin',
    spawn: () => ({
      completed: Promise.resolve({
        stdout,
        stderr: '',
        exitCode: 0,
        failure: undefined,
        ...overrides,
      }),
      stop() {},
      cancel() {},
    }),
  });

describe('independent Xcode host preflight', () => {
  test('passes only the helper and Xcode path, never device metadata', async () => {
    let command: string[] = [];
    const result = await preflightXcodeMemory(input, {
      platform: 'darwin',
      spawn: (args, options) => {
        command = args;
        expect(options.timeoutMs).toBe(5000);
        return {
          completed: Promise.resolve({
            stdout: JSON.stringify(valid),
            stderr: '',
            exitCode: 0,
            failure: undefined,
          }),
          stop() {},
          cancel() {},
        };
      },
    });
    expect(command).toEqual([input.helperPath, input.xcodePath]);
    expect(result).toEqual({
      status: 'eligible',
      reason: 'xcode_not_running',
      targetVerified: false,
      xcodeVersion: '26.5',
    });
  });

  test('missing AX permission and existing instances remain blocked', async () => {
    for (const reason of [
      'accessibility_unavailable',
      'xcode_instance_conflict',
      'accessibility_query_failed',
    ]) {
      expect(await run(JSON.stringify({ ...valid, status: 'blocked', reason }))).toMatchObject({
        status: 'blocked',
        reason,
      });
    }
  });

  test('rejects absent, truncated, multiple, oversized, or inconsistent protocol output', async () => {
    const messages = [
      '',
      '{',
      'null',
      '[]',
      JSON.stringify(valid) + JSON.stringify(valid),
      'x'.repeat(1025),
      JSON.stringify({ ...valid, protocolVersion: 2 }),
      JSON.stringify({ ...valid, targetVerified: true }),
      JSON.stringify({ ...valid, xcodeVersion: undefined }),
      JSON.stringify({ ...valid, xcodeVersion: 'private path' }),
      JSON.stringify({ ...valid, status: 'ready' }),
      JSON.stringify({ ...valid, reason: 'accessibility_unavailable' }),
      JSON.stringify({ ...valid, rawAX: 'sensitive' }),
    ];
    for (const message of messages) expect((await run(message)).reason).toBe('protocol_invalid');
  });

  test('never accepts a summary from a failed or interrupted process', async () => {
    for (const override of [{ exitCode: 1 }, { stderr: 'sensitive' }, { failure: 'transport' }]) {
      expect(await run(JSON.stringify(valid), override)).toEqual({
        status: 'blocked',
        reason: 'process_failed',
        targetVerified: false,
      });
    }
    expect(
      (await run(JSON.stringify(valid), { failure: 'performance.process_timeout' })).reason,
    ).toBe('timeout');
    expect((await run(JSON.stringify(valid), { failure: 'performance.cancelled' })).reason).toBe(
      'cancelled',
    );
  });

  test('invalid target, unsupported host, and pre-abort spawn nothing', async () => {
    let calls = 0;
    const spawn = () => {
      calls++;
      throw new Error('must not spawn');
    };
    expect(
      (await preflightXcodeMemory({ ...input, helperPath: 'relative' }, { spawn })).reason,
    ).toBe('invalid_input');
    expect(
      (
        await preflightXcodeMemory(
          { ...input, target: { ...input.target, deviceId: '' } },
          { spawn },
        )
      ).reason,
    ).toBe('invalid_input');
    expect((await preflightXcodeMemory(input, { spawn, platform: 'linux' })).reason).toBe(
      'unsupported_host',
    );
    expect(
      (await preflightXcodeMemory({ ...input, signal: AbortSignal.abort() }, { spawn })).reason,
    ).toBe('cancelled');
    expect(calls).toBe(0);
  });

  test('real transport cancellation waits for child exit and redacts diagnostics', async () => {
    const abort = new AbortController();
    let exited: Promise<number> | undefined;
    const result = await preflightXcodeMemory(
      { ...input, signal: abort.signal },
      {
        platform: 'darwin',
        spawn: (_args, options) => {
          const child = startCaptureProcess(
            [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
            options,
          );
          exited = child.exited;
          abort.abort();
          return child;
        },
      },
    );
    expect(result.reason).toBe('cancelled');
    expect(typeof (await exited)).toBe('number');
  });

  test('real transport bounds a non-responsive child', async () => {
    let exited: Promise<number> | undefined;
    const result = await preflightXcodeMemory(input, {
      platform: 'darwin',
      spawn: (_args, options) => {
        const child = startCaptureProcess([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
          ...options,
          timeoutMs: 30,
        });
        exited = child.exited;
        return child;
      },
    });
    expect(result.reason).toBe('timeout');
    expect(typeof (await exited)).toBe('number');
  });

  test('spawn and transport failures expose only stable reasons', async () => {
    expect(
      (
        await preflightXcodeMemory(input, {
          platform: 'darwin',
          spawn: () => {
            throw new Error('private');
          },
        })
      ).reason,
    ).toBe('process_failed');
    expect(
      (
        await preflightXcodeMemory(input, {
          platform: 'darwin',
          spawn: () => ({
            completed: Promise.reject(new Error('private')),
            stop() {},
            cancel() {},
          }),
        })
      ).reason,
    ).toBe('process_failed');
  });
});
