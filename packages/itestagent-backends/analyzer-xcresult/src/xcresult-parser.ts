/**
 * Core xcresult parser adapter.
 *
 * Wraps the `xcresultparser` and `xcparse` CLI tools to parse .xcresult bundles
 * into normalized test results. All subprocess calls use the injected spawnAsync
 * function (DI pattern from build-xcodebuild).
 *
 * @see AGENTS.md R2: CLI wrapping only — no binary parsing.
 * @see AGENTS.md R5: Never throw on parse failures; return partial/empty results.
 * @see AGENTS.md R12: All code/comments in English.
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

import type { ArtifactRef } from 'itestagent-contracts';

import { normalizeExecution, normalizeMetrics, normalizeTestCases } from './normalize.js';
import type { JUnitSummary, ParsedJUnitTest } from './normalize.js';
import type { XcresultParseResult, XcresultParserDeps, XcresultParserOptions } from './types.js';

// ─── Constants ────────────────────────────────────────────────

const XCRESULTPARSER_BIN = 'xcresultparser';
const XCPARSE_BIN = 'xcparse';
const XCRUN_BIN = 'xcrun';

// ─── JUnit XML Parser (regex-based, no external dependency) ───

/**
 * Extract an attribute value from an XML attribute string.
 * Example: attrValue('name="foo" time="1.2"', 'time') → '1.2'
 *
 * Uses word-boundary matching to avoid matching attribute name suffixes
 * (e.g. matching 'name' inside 'classname').
 */
function attrValue(attrs: string, name: string): string | undefined {
  const regex = new RegExp(`(?:^|\\s)${name}="([^"]*)"`);
  const match = attrs.match(regex);
  return match?.[1];
}

/**
 * Parse JUnit XML into structured test results and summary.
 *
 * Uses regex-based parsing — no external XML dependency (xml2js, fast-xml-parser, etc.).
 * JUnit XML structure:
 * ```
 * <testsuites>
 *   <testsuite name="..." tests="..." failures="..." errors="..." time="..." timestamp="...">
 *     <testcase classname="..." name="..." time="...">
 *       <failure message="...">...</failure>
 *     </testcase>
 *     <testcase classname="..." name="..." time="...">
 *       <skipped/>
 *     </testcase>
 *   </testsuite>
 * </testsuites>
 * ```
 */
function parseJUnitXml(xml: string): {
  tests: ParsedJUnitTest[];
  summary: JUnitSummary;
} {
  // Iterate all <testsuite> elements to aggregate metadata across multiple suites
  const suiteRegex = /<testsuite\s+([^>]+)>/g;
  let totalTime = 0;
  let timestamp: string | undefined;
  let testsCount = 0;
  let failuresCount = 0;
  let errorsCount = 0;
  let skippedCount = 0;

  for (let sm = suiteRegex.exec(xml); sm !== null; sm = suiteRegex.exec(xml)) {
    const attrs = sm[1] ?? '';
    totalTime += Number.parseFloat(attrValue(attrs, 'time') ?? '0');
    // Use last suite's timestamp (most recent)
    const ts = attrValue(attrs, 'timestamp');
    if (ts) timestamp = ts;
    testsCount += Number.parseInt(attrValue(attrs, 'tests') ?? '0', 10);
    failuresCount += Number.parseInt(attrValue(attrs, 'failures') ?? '0', 10);
    errorsCount += Number.parseInt(attrValue(attrs, 'errors') ?? '0', 10);
    skippedCount += Number.parseInt(attrValue(attrs, 'skipped') ?? '0', 10);
  }

  // Extract testcase elements
  const testcaseRegex = /<testcase\s+([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/testcase>)/g;
  const tests: ParsedJUnitTest[] = [];

  for (let match = testcaseRegex.exec(xml); match !== null; match = testcaseRegex.exec(xml)) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';
    const name = attrValue(attrs, 'name') ?? 'unknown';
    const classname = attrValue(attrs, 'classname') ?? 'unknown';
    const time = Number.parseFloat(attrValue(attrs, 'time') ?? '0');

    let status: ParsedJUnitTest['status'] = 'passed';
    let failureMessage: string | undefined;

    if (/<failure\b/.test(inner)) {
      status = 'failed';
      const msgMatch = inner.match(/<failure[^>]*message="([^"]*)"/);
      failureMessage = msgMatch?.[1] ?? 'Test failed';
    } else if (/<skipped\b/.test(inner)) {
      status = 'skipped';
    } else if (/<error\b/.test(inner)) {
      status = 'failed';
      const msgMatch = inner.match(/<error[^>]*message="([^"]*)"/);
      failureMessage = msgMatch?.[1] ?? 'Test error';
    }

    tests.push({ name, classname, time, status, failureMessage });
  }

  // Calculate actual counts from parsed results (overrides attribute counts if present)
  const actualPassed = tests.filter((t) => t.status === 'passed').length;
  const actualFailed = tests.filter((t) => t.status === 'failed').length;
  const actualSkipped = tests.filter((t) => t.status === 'skipped').length;
  const actualTotal = tests.length;

  return {
    tests,
    summary: {
      totalTests: actualTotal > 0 ? actualTotal : testsCount,
      passed:
        actualTotal > 0 ? actualPassed : testsCount - failuresCount - errorsCount - skippedCount,
      failed: actualTotal > 0 ? actualFailed : failuresCount + errorsCount,
      skipped: actualTotal > 0 ? actualSkipped : skippedCount,
      totalTime,
      timestamp,
    },
  };
}

// ─── Target Info Parser ───────────────────────────────────────

/**
 * Parse xcresultparser --target-info output.
 * Expected format: one target name per line.
 */
function parseTargetInfo(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Parse authoritative Target/Class/Method identifiers from Xcode test result nodes. */
export function parseAuthoritativeCaseIds(stdout: string): string[] {
  let root: unknown;
  try {
    root = JSON.parse(stdout);
  } catch {
    return [];
  }
  const identifiers = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.nodeType === 'Test Case' && typeof record.nodeIdentifierURL === 'string') {
      try {
        const url = new URL(record.nodeIdentifierURL);
        if (url.protocol === 'test:' && url.hostname === 'com.apple.xcode') {
          const segments = url.pathname
            .split('/')
            .filter(Boolean)
            .map((segment) => decodeURIComponent(segment));
          const [target, className, method] = segments.slice(-3);
          if (
            target &&
            className &&
            method &&
            [target, className, method].every((segment) => !/[\s/]/.test(segment))
          ) {
            identifiers.add(`${target}/${className}/${method}`);
          }
        }
      } catch {
        // R5: malformed node URLs are ignored rather than guessed.
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(root);
  return [...identifiers];
}

// ─── Empty Result Helper ──────────────────────────────────────

function emptyResult(reason?: string): XcresultParseResult {
  const now = new Date().toISOString();
  return {
    cases: [],
    execution: {
      startTime: now,
      endTime: now,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      targetNames: [],
    },
    metrics: { approximate: true },
    attachments: [],
    error: reason,
  };
}

// ─── Factory ──────────────────────────────────────────────────

/**
 * Create an xcresult parser adapter with injected dependencies.
 *
 * @param deps - Injectable dependencies (spawnAsync).
 * @returns An object with a `parse` method.
 */
export function createXcresultParser(deps: XcresultParserDeps) {
  const { spawnAsync } = deps;

  /**
   * Parse an .xcresult bundle into normalized test results.
   *
   * Steps:
   *   1. Verify xcresultPath exists on disk.
   *   2. Run `xcresultparser -o junit` → parse JUnit XML.
   *   3. Run `xcresultparser --target-info` → extract target names when available.
   *   4. Run Xcode's `xcresulttool get test-results tests` → authoritative case IDs.
   *   5. If includeAttachments: run `xcparse screenshots` → list attachments.
   *   6. Normalize and return.
   *
   * R5: Never throws — returns empty/partial result with error field on failure.
   *
   * @param options - Parse options.
   * @returns Normalized parse result.
   */
  async function parse(options: XcresultParserOptions): Promise<XcresultParseResult> {
    const { xcresultPath, includeAttachments, signal } = options;

    // R5: Check xcresultPath existence
    if (!existsSync(xcresultPath)) {
      return emptyResult(`xcresultPath does not exist: ${xcresultPath}`);
    }

    // ── 1. Run xcresultparser -o junit ────────────────────────
    const junitResult = await spawnAsync(XCRESULTPARSER_BIN, ['-o', 'junit', xcresultPath], {
      signal,
    });

    if (signal?.aborted) {
      return emptyResult('Parse aborted');
    }

    if (junitResult.exitCode !== 0) {
      return emptyResult(
        `xcresultparser -o junit exited with code ${junitResult.exitCode}: ${junitResult.stderr}`,
      );
    }

    const { tests: parsedTests, summary: junitSummary } = parseJUnitXml(junitResult.stdout);

    // ── 2. Run xcresultparser --target-info ───────────────────
    const targetResult = await spawnAsync(XCRESULTPARSER_BIN, ['--target-info', xcresultPath], {
      signal,
    });

    if (signal?.aborted) {
      return emptyResult('Parse aborted');
    }

    let targetNames: string[] = [];
    if (targetResult.exitCode === 0) {
      targetNames = parseTargetInfo(targetResult.stdout);
    }
    // R5: --target-info failure is non-fatal; targetNames remains empty

    const authoritativeResult = await spawnAsync(
      XCRUN_BIN,
      ['xcresulttool', 'get', 'test-results', 'tests', '--path', xcresultPath, '--compact'],
      { signal },
    );
    if (signal?.aborted) return emptyResult('Parse aborted');
    const authoritativeCaseIds =
      authoritativeResult.exitCode === 0
        ? parseAuthoritativeCaseIds(authoritativeResult.stdout)
        : [];
    if (targetNames.length === 0) {
      targetNames = [
        ...new Set(
          authoritativeCaseIds.map((caseId) => caseId.split('/')[0]).filter(Boolean) as string[],
        ),
      ];
    }

    // ── 3. Extract attachments via xcparse (if enabled) ───────
    const attachments: ArtifactRef[] = [];

    if (includeAttachments) {
      const tempDir = pathJoin(tmpdir(), `xcparse-${Date.now()}`);
      try {
        mkdirSync(tempDir, { recursive: true });

        const xcparseResult = await spawnAsync(
          XCPARSE_BIN,
          ['screenshots', '--os', '--model', xcresultPath, tempDir],
          { signal },
        );

        if (signal?.aborted) {
          return emptyResult('Parse aborted');
        }

        if (xcparseResult.exitCode === 0) {
          const files = readdirSync(tempDir, { recursive: true, encoding: 'utf8' });
          for (const file of files) {
            const filePath = pathJoin(tempDir, file);
            attachments.push({
              id: `attach-${file}`,
              type: 'screenshot',
              path: filePath,
              redactionStatus: 'raw-local-only',
            });
          }
        }
        // R5: xcparse failure is non-fatal; attachments remains empty
      } catch {
        // R5: File system errors are non-fatal
      } finally {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
    }

    // ── 4. Normalize ──────────────────────────────────────────
    const cases = normalizeTestCases(parsedTests, targetNames, authoritativeCaseIds);
    const execution = normalizeExecution(junitSummary, targetNames);
    const metrics = normalizeMetrics(junitSummary);

    return {
      cases,
      execution,
      metrics,
      attachments,
    };
  }

  return { parse };
}
