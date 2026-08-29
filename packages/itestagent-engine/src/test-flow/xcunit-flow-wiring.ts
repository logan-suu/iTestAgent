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
import {
  type XcodebuildProcessRunner,
  runXcodebuildTests,
} from 'itestagent-backends-build-xcodebuild';
import type { XcunitFlowDeps } from './run-xcunit-flow.js';

/** Default async process runner (Bun.spawn — mirrors build-xcodebuild). */
const defaultProcessRunner: XcodebuildProcessRunner = async (cmd, args, options) => {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: options?.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
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
export function createRealXcunitFlowDeps(runner?: XcodebuildProcessRunner): XcunitFlowDeps {
  const processRunner: XcodebuildProcessRunner = runner ?? defaultProcessRunner;
  const parser = createXcresultParser({ spawnAsync: processRunner });
  return {
    runTests: (input) => runXcodebuildTests(input, processRunner),
    parse: (options) => parser.parse(options),
  };
}
