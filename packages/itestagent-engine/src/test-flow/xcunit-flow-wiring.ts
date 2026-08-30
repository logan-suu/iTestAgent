import { createXcresultParser } from 'itestagent-backends-analyzer-xcresult';
/**
 * Real XCUITest flow wiring — connects the injected-deps composition
 * (run-xcunit-flow) to the real backend implementations:
 *
 *   runXcodebuildTests (build-xcodebuild) + createXcresultParser
 *   (analyzer-xcresult).
 *
 * AGENTS.md §4: backends never call each other — the engine owns this
 * composition. CLI/TUI surfaces import this module (never the backends
 * directly).
 */
import { runXcodebuildTests } from 'itestagent-backends-build-xcodebuild';
import type { XcunitFlowDeps } from './run-xcunit-flow.js';

/**
 * Union of the two backend process-runner contracts this wiring serves:
 * build-xcodebuild's XcodebuildProcessRunner ({ timeoutMs?, cwd? }) and the
 * xcresult parser's SpawnAsyncFn ({ cwd?, signal?, env? }). The AbortSignal
 * is forwarded into Bun.spawn so parse cancellation reaches the child
 * process (ADR-010 abort propagation).
 */
export type XcunitFlowProcessRunner = (
  cmd: string,
  args: string[],
  options?: {
    cwd?: string;
    signal?: AbortSignal;
    env?: Record<string, string>;
  },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** Default async process runner (Bun.spawn — mirrors build-xcodebuild). */
export const defaultXcunitProcessRunner: XcunitFlowProcessRunner = async (cmd, args, options) => {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: options?.cwd,
    env: options?.env ? { ...process.env, ...options.env } : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
};

/**
 * Build the real XCUITest flow dependencies.
 *
 * @param runner - Optional process-runner override (tests inject fakes).
 */
export function createRealXcunitFlowDeps(runner?: XcunitFlowProcessRunner): XcunitFlowDeps {
  const processRunner = runner ?? defaultXcunitProcessRunner;
  const parser = createXcresultParser({ spawnAsync: processRunner });
  return {
    runTests: (input) => runXcodebuildTests(input, processRunner),
    parse: (options) => parser.parse(options),
  };
}
