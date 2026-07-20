import { afterEach, describe, expect, it } from 'bun:test';
import {
  type WhichFn,
  type XcbeautifySpawnSyncFn,
  isXcbeautifyAvailable,
  overrideWhich,
  overrideXcbeautifySpawnSync,
  pipeThroughXcbeautify,
} from '../src/xcbeautify';

// ─── Helpers ────────────────────────────────────────────────────

function mockWhich(fn: WhichFn) {
  overrideWhich(fn);
}

function mockSpawnSync(fn: XcbeautifySpawnSyncFn) {
  overrideXcbeautifySpawnSync(fn);
}

function resetAll() {
  overrideWhich(undefined);
  overrideXcbeautifySpawnSync(undefined);
}

const sampleRawOutput =
  '=== BUILD TARGET MyApp OF PROJECT MyApp ===\nCompileSwift normal arm64 /path/to/File.swift\n/Users/test/File.swift:10:5: warning: Unused variable\n** BUILD FAILED **';

const beautifiedOutput =
  '[MyApp] Compiling File.swift\n  > Thread 1: warning: Unused variable\n[MyApp] Build Failed';

afterEach(() => {
  resetAll();
});

// ─── isXcbeautifyAvailable ──────────────────────────────────────

describe('isXcbeautifyAvailable', () => {
  it('returns true when xcbeautify is on PATH', () => {
    mockWhich((_cmd) => '/usr/local/bin/xcbeautify');
    expect(isXcbeautifyAvailable()).toBe(true);
  });

  it('returns false when xcbeautify is not found', () => {
    mockWhich((_cmd) => null);
    expect(isXcbeautifyAvailable()).toBe(false);
  });
});

// ─── pipeThroughXcbeautify ──────────────────────────────────────

describe('pipeThroughXcbeautify', () => {
  it('beautifies raw output when xcbeautify is available', () => {
    mockWhich(() => '/opt/homebrew/bin/xcbeautify');
    mockSpawnSync((_cmd, _input) => ({
      exitCode: 0,
      stdout: beautifiedOutput,
      stderr: '',
    }));

    const result = pipeThroughXcbeautify(sampleRawOutput);
    expect(result).toBe(beautifiedOutput);
  });

  it('returns raw output unchanged when xcbeautify is NOT available', () => {
    mockWhich(() => null);

    const result = pipeThroughXcbeautify(sampleRawOutput);
    expect(result).toBe(sampleRawOutput);
  });

  it('returns raw output with warning prefix when xcbeautify process fails (non-zero exit)', () => {
    mockWhich(() => '/usr/local/bin/xcbeautify');
    mockSpawnSync((_cmd, _input) => ({
      exitCode: 1,
      stdout: '',
      stderr: 'parse error',
    }));

    const result = pipeThroughXcbeautify(sampleRawOutput);
    expect(result).toContain('[xcbeautify exited with code 1');
    expect(result).toContain(sampleRawOutput);
  });

  it('returns raw output with warning prefix when xcbeautify spawn throws', () => {
    mockWhich(() => '/usr/local/bin/xcbeautify');
    mockSpawnSync((_cmd, _input) => {
      throw new Error('SIGKILL');
    });

    const result = pipeThroughXcbeautify(sampleRawOutput);
    expect(result).toContain('[xcbeautify process failed');
    expect(result).toContain(sampleRawOutput);
  });

  it('handles empty input string', () => {
    mockWhich(() => '/usr/local/bin/xcbeautify');
    mockSpawnSync((_cmd, _input) => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    }));

    const result = pipeThroughXcbeautify('');
    expect(result).toBe('');
  });

  it('handles input with ANSI escape codes', () => {
    const ansiInput = '\x1b[31merror: \x1b[0mBuild failed\n\x1b[1mwarning:\x1b[0m Deprecated API';
    const ansiBeautified = '[MyApp] error: Build failed\n  warning: Deprecated API';

    mockWhich(() => '/usr/local/bin/xcbeautify');
    mockSpawnSync((_cmd, _input) => ({
      exitCode: 0,
      stdout: ansiBeautified,
      stderr: '',
    }));

    const result = pipeThroughXcbeautify(ansiInput);
    expect(result).toBe(ansiBeautified);
  });

  it('pipes stdin correctly to xcbeautify', () => {
    let capturedInput: string | undefined;

    mockWhich(() => '/usr/local/bin/xcbeautify');
    mockSpawnSync((_cmd, input) => {
      capturedInput = input;
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    });

    pipeThroughXcbeautify(sampleRawOutput);
    expect(capturedInput).toBe(sampleRawOutput);
  });

  it('returns raw output unchanged when which returns empty string (edge case)', () => {
    mockWhich(() => '');

    const result = pipeThroughXcbeautify(sampleRawOutput);
    // Falsy check: empty string is not null but is falsy — treat as unavailable
    expect(result).toBe(sampleRawOutput);
  });
});
