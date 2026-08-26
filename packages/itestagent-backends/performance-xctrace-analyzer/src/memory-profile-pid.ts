/**
 * Process PID extraction — B22 module split (promotion guide §11.3
 * "parameterized memory profile").
 *
 * Discovers the target process pid from profiling tool output so
 * per-process memory facts can be associated. Returns null when no pid is
 * present rather than guessing.
 */

/**
 * Extracts a process pid from profiling text (e.g. a `leaks` header line
 * like "Process 123: FixtureApp [pid 123]" or a bare "pid: 4567" line).
 */
export function findProcessPid(text: string): number | null {
  const header = /\bProcess\s+(\d+)\b/.exec(text);
  if (header?.[1]) return Number.parseInt(header[1], 10);
  const pidLine = /(?:^|\n)\s*pid:\s*(\d+)/.exec(text);
  if (pidLine?.[1]) return Number.parseInt(pidLine[1], 10);
  return null;
}
