import type {
  XcresultParseResult,
  XcresultParserOptions,
} from 'itestagent-backends-analyzer-xcresult';
import type {
  XcodebuildTestRunInput,
  XcodebuildTestRunOutput,
} from 'itestagent-backends-build-xcodebuild';
/**
 * XCUITest flow — engine composition over two backend components:
 *
 *   runXcodebuildTests (build-xcodebuild) → createXcresultParser
 *   (analyzer-xcresult) → normalized cases/metrics.
 *
 * AGENTS.md §4: backends never call each other — the engine owns this
 * composition. Both operations are injected so the flow is unit-testable
 * without xcodebuild/xcresultparser binaries.
 */
import type { BuildDestination } from 'itestagent-contracts';

export interface XcunitFlowInput {
  /** Project/workspace directory passed as the child process cwd. */
  projectRoot: string;
  scheme: string;
  testPlan?: string;
  allowProvisioningUpdates?: boolean;
  destination?: BuildDestination;
  /** Test identifiers filtered as -only-testing. */
  only?: string[];
  /** Where the .xcresult bundle is written (passed via -resultBundlePath). */
  resultBundlePath: string;
  /** Extract screenshot attachments from the bundle. */
  includeAttachments?: boolean;
}

export interface XcunitFlowDeps {
  runTests(input: XcodebuildTestRunInput): Promise<XcodebuildTestRunOutput>;
  parse(options: XcresultParserOptions): Promise<XcresultParseResult>;
}

export interface XcunitFlowResult {
  exitCode: number;
  durationMs: number;
  /** Normalized parse result — null when the bundle was not produced. */
  parsed: XcresultParseResult | null;
  parseError?: string;
}

/**
 * Run XCUITests and normalize the xcresult bundle.
 *
 * The `-resultBundlePath` is owned by this flow (passed as extraArgs) so the
 * artifact location is deterministic. Parse failures are captured (R5) — a
 * failed test run still parses its bundle (failures are the interesting case).
 */
export async function runXcunitFlow(
  input: XcunitFlowInput,
  deps: XcunitFlowDeps,
): Promise<XcunitFlowResult> {
  const run = await deps.runTests({
    projectRoot: input.projectRoot,
    scheme: input.scheme,
    testPlan: input.testPlan,
    allowProvisioningUpdates: input.allowProvisioningUpdates,
    destination: input.destination,
    only: input.only,
    extraArgs: ['-resultBundlePath', input.resultBundlePath],
  });

  let parsed: XcresultParseResult | null = null;
  let parseError: string | undefined;
  try {
    parsed = await deps.parse({
      xcresultPath: input.resultBundlePath,
      includeAttachments: input.includeAttachments,
    });
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  return {
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    parsed,
    parseError,
  };
}
