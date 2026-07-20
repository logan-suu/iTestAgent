/**
 * xcbeautify pipe module — beautifies raw xcodebuild output.
 *
 * Pipes raw xcodebuild output through the xcbeautify CLI
 * (https://github.com/cpisciotta/xcbeautify) for human-readable formatting.
 * Falls back to raw output if xcbeautify is not installed.
 *
 * Per US-6.2 AC2: "构建日志经 xcbeautify 可读化" (build log readability).
 *
 * Per R5: no silent degradation — uncertain results are explicitly marked.
 */

// ─── DI (Dependency Injection) for testability ──────────────────

/** Signature for `Bun.which` — finds a command on PATH. */
export type WhichFn = (cmd: string) => string | null;

/** Signature for spawning xcbeautify — pipes stdin, returns stdout/stderr. */
export type XcbeautifySpawnSyncFn = (
  cmd: string[],
  input?: string,
) => { exitCode: number; stdout: string; stderr: string };

/** Default implementation using real `Bun.which`. */
export let whichImpl: WhichFn = (cmd) => Bun.which(cmd);

/** Default implementation using real `Bun.spawnSync`. */
export let xcbeautifySpawnSyncImpl: XcbeautifySpawnSyncFn = (cmd, input) => {
  const result = Bun.spawnSync({
    cmd,
    stdin: input != null ? new TextEncoder().encode(input) : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

/**
 * Override the `which` implementation (for testing).
 * Call with `undefined` to reset to default.
 */
export function overrideWhich(fn: WhichFn | undefined): void {
  if (fn) {
    whichImpl = fn;
  } else {
    whichImpl = (cmd) => Bun.which(cmd);
  }
}

/**
 * Override the spawn implementation (for testing).
 * Call with `undefined` to reset to default.
 */
export function overrideXcbeautifySpawnSync(fn: XcbeautifySpawnSyncFn | undefined): void {
  if (fn) {
    xcbeautifySpawnSyncImpl = fn;
  } else {
    xcbeautifySpawnSyncImpl = (cmd, input) => {
      const result = Bun.spawnSync({
        cmd,
        stdin: input != null ? new TextEncoder().encode(input) : undefined,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    };
  }
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Check if xcbeautify CLI is available on PATH.
 *
 * Uses `Bun.which` (or the injected mock) to locate the binary.
 */
export function isXcbeautifyAvailable(): boolean {
  const path = whichImpl('xcbeautify');
  return path !== null && path !== '';
}

/**
 * Pipe raw xcodebuild output through xcbeautify for human-readable formatting.
 *
 * Behavior:
 * - If xcbeautify is available on PATH: pipes `rawOutput` via stdin into the
 *   xcbeautify CLI and returns the beautified stdout.
 * - If xcbeautify is not installed: returns `rawOutput` unchanged as a graceful
 *   fallback (no error thrown).
 * - If the xcbeautify process exits with a non-zero code or throws: returns
 *   `rawOutput` with a warning prefix so the consumer knows the output is raw
 *   (per R5 — no silent degradation).
 *
 * @param rawOutput - Raw xcodebuild stdout/stderr string.
 * @returns Beautified output string, or the original input on fallback.
 */
export function pipeThroughXcbeautify(rawOutput: string): string {
  if (!isXcbeautifyAvailable()) {
    return rawOutput;
  }

  try {
    const result = xcbeautifySpawnSyncImpl(['xcbeautify'], rawOutput);

    if (result.exitCode !== 0) {
      return `[xcbeautify exited with code ${result.exitCode}, falling back to raw output]\n${rawOutput}`;
    }

    return result.stdout;
  } catch (err) {
    // Process crash, SIGKILL, etc. — fall back to raw output with explicit mark.
    const reason = err instanceof Error ? err.message : String(err);
    return `[xcbeautify process failed: ${reason}, falling back to raw output]\n${rawOutput}`;
  }
}
