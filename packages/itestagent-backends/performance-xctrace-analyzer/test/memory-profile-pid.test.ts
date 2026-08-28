/**
 * memory-profile-pid.test.ts — B22 process-pid extraction (promotion guide
 * §11.3 "parameterized memory profile").
 *
 * Locks PID discovery from profiling tool output (e.g. the `leaks` report
 * header) so the runner can associate per-process memory facts.
 */
import { describe, expect, it } from 'bun:test';
import { findProcessPid } from '../src/memory-profile-pid.js';

describe('findProcessPid', () => {
  it('extracts the pid from a leaks report header', () => {
    expect(findProcessPid('Process 123: FixtureApp [pid 123]')).toBe(123);
  });

  it('extracts a bare pid line', () => {
    expect(findProcessPid('pid: 4567\n')).toBe(4567);
  });

  it('returns null when no pid is present', () => {
    expect(findProcessPid('no process info')).toBeNull();
  });
});
