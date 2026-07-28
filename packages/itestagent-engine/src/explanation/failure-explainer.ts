import type {
  ArtifactRef,
  BaselineDelta,
  FailureExplanation,
  RunStatus,
  RunStep,
  TraceSummary,
} from 'itestagent-contracts';

// ─── Types ────────────────────────────────────────────────────────

export interface ExplainContext {
  runId: string;
  status: RunStatus;
  projectProfileRef: string;
  testPlanName?: string;
  steps: RunStep[];
  evidence: ArtifactRef[];
  traceSummary?: TraceSummary;
  baselineDelta?: BaselineDelta;
  targetKind: 'physical' | 'simulator';
  previousRuns?: PreviousRunInfo[];
}

export interface PreviousRunInfo {
  runId: string;
  status: RunStatus;
  scenario: string;
}

export type LlmExplainFn = (context: ExplainContext) => Promise<FailureExplanation>;

export interface FailureExplainerOptions {
  llmExplain?: LlmExplainFn;
  perfRegressionThresholds?: {
    launchTimeMs?: number;
    memoryPeakMb?: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────

const DEFAULT_LAUNCH_TIME_MS = 500;
const DEFAULT_MEMORY_PEAK_MB = 100;

const CRASHLOG_TYPE = 'crashlog';
const DEVICE_OFFLINE_ERRORS = [
  'device offline',
  'device not found',
  'timeout',
  'connection refused',
  'no device connected',
];

const ENV_ISSUE_ERRORS = [
  'provisioning profile',
  'code signing',
  'xcodebuild',
  'build failed',
  'simctl',
  'simulator not found',
  'launchd',
];

// ─── FailureExplainer ─────────────────────────────────────────────

export class FailureExplainer {
  private llmExplain?: LlmExplainFn;
  private readonly launchTimeThresholdMs: number;
  private readonly memoryPeakThresholdMb: number;

  constructor(options: FailureExplainerOptions = {}) {
    this.llmExplain = options.llmExplain;
    this.launchTimeThresholdMs =
      options.perfRegressionThresholds?.launchTimeMs ?? DEFAULT_LAUNCH_TIME_MS;
    this.memoryPeakThresholdMb =
      options.perfRegressionThresholds?.memoryPeakMb ?? DEFAULT_MEMORY_PEAK_MB;
  }

  async explain(context: ExplainContext): Promise<FailureExplanation> {
    const result = this.applyRules(context);
    if (result) return result;

    if (this.llmExplain) {
      return this.llmExplain(context);
    }

    return this.inconclusive(context, 'No rule matched and no LLM fallback configured');
  }

  // ── Rules Engine ─────────────────────────────────────────────

  private applyRules(context: ExplainContext): FailureExplanation | null {
    const { evidence, steps, baselineDelta, previousRuns } = context;

    const crashResult = this.checkCrashlog(evidence, steps);
    if (crashResult) return crashResult;

    const perfResult = this.checkPerfRegression(baselineDelta, evidence);
    if (perfResult) return perfResult;

    const deviceResult = this.checkDeviceIssue(context);
    if (deviceResult) return deviceResult;

    const envResult = this.checkEnvIssue(steps, context.targetKind);
    if (envResult) return envResult;

    const flakyResult = this.checkFlaky(previousRuns);
    if (flakyResult) return flakyResult;

    const historyResult = this.checkHistorical(previousRuns);
    if (historyResult) return historyResult;

    return null;
  }

  // ── Rule: Crashlog Evidence ──────────────────────────────────

  private checkCrashlog(evidence: ArtifactRef[], steps: RunStep[]): FailureExplanation | null {
    const hasCrashlog = evidence.some((a) => a.type === CRASHLOG_TYPE);

    if (!hasCrashlog) {
      const stepErrors = steps
        .filter((s) => {
          const res = s.result as Record<string, unknown> | undefined;
          return res?.error != null;
        })
        .map((s) => {
          const res = s.result as Record<string, unknown>;
          return String(res.error).toLowerCase();
        });

      const hasCrashInError = stepErrors.some(
        (e) =>
          e.includes('crash') ||
          e.includes('sigabrt') ||
          e.includes('sigsegv') ||
          e.includes('exc_bad_access'),
      );

      if (!hasCrashInError) return null;
    }

    return {
      explanationType: 'product_regression',
      summary: hasCrashlog
        ? 'App crashed during execution. Crashlog evidence collected.'
        : 'App crashed during execution. Crash detected in step error output.',
      evidence: hasCrashlog
        ? evidence.filter((a) => a.type === CRASHLOG_TYPE).map((a) => a.id)
        : steps
            .filter((s) => {
              const res = s.result as Record<string, unknown> | undefined;
              return res?.error != null;
            })
            .map((s) => s.stepId),
      confidence: hasCrashlog ? 'high' : 'medium',
      suggestedActions: [
        'Symbolicate crashlog to identify root cause',
        'Check crash in Xcode Organizer → Crashes',
        'Reproduce locally with debugger attached',
      ],
    };
  }

  // ── Rule: Performance Regression ─────────────────────────────

  private checkPerfRegression(
    baselineDelta?: BaselineDelta,
    evidence?: ArtifactRef[],
  ): FailureExplanation | null {
    if (!baselineDelta || !baselineDelta.deltas) return null;

    const { deltas } = baselineDelta;
    const launchMs = deltas.launchDurationMs;
    const memMb = deltas.memoryPeakMB;
    const hangCount = deltas.hangCount;

    const launchRegressed = launchMs !== undefined && launchMs > this.launchTimeThresholdMs;
    const memRegressed = memMb !== undefined && memMb > this.memoryPeakThresholdMb;
    const hangRegressed = hangCount !== undefined && hangCount > 0;

    if (!launchRegressed && !memRegressed && !hangRegressed) return null;

    const regressions: string[] = [];
    if (launchMs !== undefined && launchRegressed) {
      regressions.push(`launch time +${launchMs.toFixed(0)}ms`);
    }
    if (memMb !== undefined && memRegressed) {
      regressions.push(`memory peak +${memMb.toFixed(0)}MB`);
    }
    if (hangRegressed) regressions.push(`hangs +${hangCount}`);

    const traceEvidence = evidence?.filter((a) => a.type === 'trace').map((a) => a.id) ?? [];

    return {
      explanationType: 'perf_regression',
      summary: `Performance regression detected: ${regressions.join(', ')} compared to baseline.`,
      evidence: [
        `baseline_delta: launch=${launchMs ?? 'N/A'}ms, memory=${memMb ?? 'N/A'}MB, hangs=${hangCount ?? 'N/A'}`,
        ...traceEvidence,
      ],
      confidence: 'medium',
      suggestedActions: [
        'Review Instruments Time Profiler trace to identify hot path',
        "Compare with previous build's trace",
        'Check for recent changes that may impact launch or memory',
      ],
    };
  }

  // ── Rule: Device Issue ───────────────────────────────────────

  private checkDeviceIssue(context: ExplainContext): FailureExplanation | null {
    const { steps, targetKind } = context;

    const deviceErrorSteps = steps.filter((s) => {
      const res = s.result as Record<string, unknown> | undefined;
      if (!res?.error) return false;
      const error = String(res.error).toLowerCase();
      return DEVICE_OFFLINE_ERRORS.some((pat) => error.includes(pat));
    });

    if (deviceErrorSteps.length === 0) return null;

    const deviceLabel = targetKind === 'physical' ? 'Physical device' : 'Simulator';
    const reason =
      targetKind === 'physical'
        ? 'Device may be disconnected, locked, or WDA session lost'
        : 'Simulator may have terminated, crashed, or CoreSimulator service unavailable';

    return {
      explanationType: 'device_issue',
      summary: `${deviceLabel} issue detected: ${deviceErrorSteps.length} step(s) failed due to device communication error. ${reason}.`,
      evidence: deviceErrorSteps.map((s) => s.stepId),
      confidence: 'high',
      suggestedActions:
        targetKind === 'physical'
          ? [
              'Check device USB connection and trust state',
              'Verify device is unlocked and not in DFU/recovery mode',
              'Restart WDA (WebDriverAgent) on the device',
            ]
          : [
              'Restart the simulator via simctl',
              'Check CoreSimulator logs in ~/Library/Logs/CoreSimulator',
              'Reset simulator content and settings if persistent',
            ],
    };
  }

  // ── Rule: Environment Issue ──────────────────────────────────

  private checkEnvIssue(steps: RunStep[], targetKind: string): FailureExplanation | null {
    const envErrorSteps = steps.filter((s) => {
      const res = s.result as Record<string, unknown> | undefined;
      if (!res?.error) return false;
      const error = String(res.error).toLowerCase();
      return ENV_ISSUE_ERRORS.some((pat) => error.includes(pat));
    });

    if (envErrorSteps.length === 0) return null;

    return {
      explanationType: 'env_issue',
      summary: `Environment issue detected: ${envErrorSteps.length} step(s) failed due to provisioning, signing, build, or simulator environment errors.`,
      evidence: envErrorSteps.map((s) => s.stepId),
      confidence: 'high',
      suggestedActions: [
        'Run `itestagent doctor` to diagnose environment',
        'Check Xcode version and command line tools',
        'Verify provisioning profiles and signing certificates',
        targetKind === 'simulator'
          ? 'Check simctl boot status and CoreSimulator logs'
          : 'Verify device provisioning profile includes the device UDID',
      ],
    };
  }

  // ── Rule: Flaky Detection ────────────────────────────────────

  private checkFlaky(previousRuns?: PreviousRunInfo[]): FailureExplanation | null {
    if (!previousRuns || previousRuns.length < 2) return null;

    const passedCount = previousRuns.filter(
      (r) => r.status === 'passed' || r.status === 'explored',
    ).length;
    const failedCount = previousRuns.filter(
      (r) => r.status === 'failed' || r.status === 'flaky',
    ).length;

    if (passedCount > 0 && failedCount > 0 && passedCount >= failedCount) {
      return {
        explanationType: 'flaky',
        summary: `Test appears flaky: ${passedCount} previous runs passed, ${failedCount} failed.`,
        evidence: previousRuns.map((r) => `${r.runId}:${r.status}`),
        confidence: 'medium',
        suggestedActions: [
          'Re-run the same scenario 3-5 times to confirm flakiness',
          'Check for timing-dependent behavior or network calls',
          'Consider adding explicit waits rather than implicit timeouts',
        ],
      };
    }

    return null;
  }

  // ── Rule: Historical Product Regression ──────────────────────

  private checkHistorical(previousRuns?: PreviousRunInfo[]): FailureExplanation | null {
    if (!previousRuns || previousRuns.length === 0) return null;

    const allPassed = previousRuns.every((r) => r.status === 'passed' || r.status === 'explored');

    if (allPassed && previousRuns.length >= 1) {
      return {
        explanationType: 'product_regression',
        summary: `All ${previousRuns.length} previous runs for this scenario passed. Current failure suggests a product regression.`,
        evidence: previousRuns.map((r) => `${r.runId}:${r.status}`),
        confidence: 'high',
        suggestedActions: [
          'Check recent code changes that may have introduced the regression',
          'Compare with the last passing commit',
          'Run git bisect to identify the breaking change',
        ],
      };
    }

    return null;
  }

  // ── Fallback: Inconclusive ───────────────────────────────────

  private inconclusive(context: ExplainContext, reason: string): FailureExplanation {
    return {
      explanationType: 'inconclusive',
      summary: `Unable to determine root cause of failure (R5: not fabricated). ${reason}.`,
      evidence: context.steps.map((s) => s.stepId),
      confidence: 'low',
      suggestedActions: [
        'Review all collected artifacts (screenshots, logs, traces)',
        'Run `itestagent explain <run_id>` for manual review',
        'Check if the same scenario passes when run in isolation',
      ],
    };
  }
}
