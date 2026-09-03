import { afterAll, beforeEach, describe, expect, it, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  BaselineDelta,
  ExecutionSummary,
  FailureExplanation,
  PerformanceMetrics,
  RunStatus,
  RunStep,
  TestCaseResult,
} from 'itestagent-contracts';
import { ArtifactIndexSchema, RunResultSchema } from 'itestagent-contracts';

import { generateSummary } from '../src/summary-generator.js';
import { ReportSynthesizer } from '../src/synthesizer.js';
import type { ArtifactEntry, ReportSynthesizerInput } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'itestagent-report-test-'));
});

afterAll(async () => {
  // Cleanup is best-effort
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function device(overrides: Partial<ReportSynthesizerInput['device']> = {}) {
  return {
    udid: '00008110-ABCDEF1234567890',
    name: 'iPhone 15 Pro',
    model: 'iPhone16,1',
    osVersion: '18.2',
    targetKind: 'physical' as const,
    ...overrides,
  };
}

function execution(overrides: Partial<ExecutionSummary> = {}): ExecutionSummary {
  return {
    totalSteps: 5,
    completedSteps: 4,
    failedSteps: 1,
    skippedSteps: 0,
    durationMs: 12000,
    startTime: '2026-07-28T10:00:00.000Z',
    endTime: '2026-07-28T10:00:12.000Z',
    targetKind: 'physical',
    backendUsed: 'appium',
    deviceId: '00008110-ABCDEF1234567890',
    ...overrides,
    mode: overrides.mode ?? 'device_backend',
  };
}

function metrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    launchDurationMs: 850,
    memoryPeakMB: 142,
    crashDetected: false,
    hangCount: 0,
    hitchesSummary: 'low',
    fpsApproximate: 59.2,
    approximate: false,
    ...overrides,
  };
}

function environment(overrides: Partial<ReportSynthesizerInput['environment']> = {}) {
  return {
    targetKind: 'physical' as const,
    representativeOfPhysicalDevice: true,
    comparisonScope: 'physical_only' as const,
    xcodeVersion: '16.2',
    ...overrides,
  };
}

function baselineDelta(overrides: Partial<BaselineDelta> = {}): BaselineDelta {
  return {
    baselineId: 'bl-001',
    runId: 'run-001',
    comparedAt: '2026-07-28T09:00:00.000Z',
    targetKind: 'physical',
    deltas: {
      launchDurationMs: 50,
      memoryPeakMB: 12,
      hangCount: 1,
      hitches: 'regressed',
      fpsApproximate: -2.3,
    },
    summary: 'regressed',
    ...overrides,
  };
}

function explanation(overrides: Partial<FailureExplanation> = {}): FailureExplanation {
  return {
    explanationType: 'product_regression',
    summary: 'Login button not found on home screen after authentication.',
    evidence: ['screenshot-001', 'uitree-001'],
    suggestedActions: ['Check login API response', 'Verify navigation after auth'],
    confidence: 'high',
    ...overrides,
  };
}

function step(overrides: Partial<RunStep> & { stepId?: string } = {}): RunStep {
  return {
    stepId: overrides.stepId ?? 'step-1',
    sequence: 1,
    backend: 'appium',
    targetKind: 'physical',
    action: 'tap',
    target: 'loginButton',
    input: { x: 0.5, y: 0.8 },
    result: { success: true },
    status: 'completed',
    artifacts: ['screenshot-001'],
    startedAt: '2026-07-28T10:00:01.000Z',
    durationMs: 450,
    ...overrides,
  };
}

function testCase(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    caseId: 'tc-1',
    name: 'Login smoke',
    status: 'passed',
    steps: ['step-1', 'step-2'],
    durationMs: 3200,
    artifacts: ['screenshot-001'],
    ...overrides,
  };
}

function artifactEntry(overrides: Partial<ArtifactEntry> = {}): ArtifactEntry {
  return {
    id: 'screenshot-001',
    type: 'screenshot',
    path: 'artifacts/screenshots/step-1.png',
    relatedStep: 'step-1',
    redactionStatus: 'safe',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ReportSynthesizerInput> = {}): ReportSynthesizerInput {
  return {
    runId: 'run-001',
    status: 'passed' as RunStatus,
    projectProfileRef: 'projects/abc123/project-profile.json',
    device: device(),
    execution: execution(),
    cases: [testCase()],
    metrics: metrics(),
    environment: environment(),
    artifactRefs: ['screenshot-001'],
    allArtifacts: [artifactEntry()],
    steps: [step()],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('ReportSynthesizer', () => {
  // ── AC1: Three output files ─────────────────────────────
  describe('AC1: output files', () => {
    test('write() produces summary.md, result.json, and artifact-index.json', async () => {
      const synth = new ReportSynthesizer(makeInput());
      const runDir = join(tmpDir, 'run-001');

      const paths = await synth.write(runDir);

      expect(paths.resultPath).toBe(join(runDir, 'result.json'));
      expect(paths.artifactIndexPath).toBe(join(runDir, 'artifact-index.json'));
      expect(paths.summaryPath).toBe(join(runDir, 'summary.md'));
    });

    test('write() creates parent directories automatically', async () => {
      const synth = new ReportSynthesizer(makeInput());
      const runDir = join(tmpDir, 'nested', 'run-002');

      await synth.write(runDir);

      const resultFile = Bun.file(join(runDir, 'result.json'));
      expect(await resultFile.exists()).toBe(true);
    });
  });

  // ── AC2: No report.html ────────────────────────────────
  describe('AC2: no report.html', () => {
    test('synthesizer has no HTML output method', () => {
      const synth = new ReportSynthesizer(makeInput());
      // API surface check: no html-related methods
      expect(typeof (synth as unknown as Record<string, unknown>).synthesizeHtml).toBe('undefined');
      expect(typeof (synth as unknown as Record<string, unknown>).synthesizeHTML).toBe('undefined');
    });

    test('write() does not produce any .html file', async () => {
      const synth = new ReportSynthesizer(makeInput());
      const runDir = join(tmpDir, 'run-html-check');

      await synth.write(runDir);

      const htmlFile = Bun.file(join(runDir, 'report.html'));
      expect(await htmlFile.exists()).toBe(false);
    });
  });

  // ── AC3: summary.md content ─────────────────────────────
  describe('AC3: summary.md content', () => {
    test('contains conclusion section', () => {
      const summary = generateSummary(makeInput({ status: 'passed' }));
      expect(summary).toContain('## 结论 (Conclusion)');
      expect(summary).toContain('所有测试用例通过');
    });

    test('contains failure reason section when failed', () => {
      const summary = generateSummary(
        makeInput({
          status: 'failed',
          execution: execution({ failedSteps: 3 }),
          explanation: explanation(),
        }),
      );
      expect(summary).toContain('## 失败原因 (Failure Reason)');
      expect(summary).toContain('product_regression');
      expect(summary).toContain('Login button not found');
      expect(summary).toContain('high');
      expect(summary).toContain('Suggested Actions');
      expect(summary).toContain('Check login API response');
    });

    test('omits failure reason section when passed', () => {
      const summary = generateSummary(makeInput({ status: 'passed' }));
      expect(summary).not.toContain('## 失败原因 (Failure Reason)');
    });

    test('contains key metrics section', () => {
      const summary = generateSummary(makeInput({ metrics: metrics() }));
      expect(summary).toContain('## 关键指标 (Key Metrics)');
      expect(summary).toContain('850ms');
      expect(summary).toContain('142 MB');
      expect(summary).toContain('59.2');
    });

    test('annotates approximate metrics (R5)', () => {
      const summary = generateSummary(
        makeInput({
          metrics: metrics({ approximate: true, fpsApproximate: 55.3 }),
        }),
      );
      expect(summary).toContain('(approximate)');
      expect(summary).toContain('部分指标为近似值');
    });

    test('contains evidence paths section', () => {
      const summary = generateSummary(
        makeInput({
          allArtifacts: [
            artifactEntry({ id: 'ss-1', type: 'screenshot', path: 'art/s1.png' }),
            artifactEntry({ id: 'vd-1', type: 'video', path: 'art/s1.mp4' }),
          ],
        }),
      );
      expect(summary).toContain('## 证据路径 (Evidence Paths)');
      expect(summary).toContain('art/s1.png');
      expect(summary).toContain('art/s1.mp4');
    });

    test('contains next commands section', () => {
      const summary = generateSummary(makeInput({ status: 'passed' }));
      expect(summary).toContain('## 下一步命令 (Next Commands)');
      expect(summary).toContain('itestagent explain run-001');
    });

    test('suggests rerun --failed-only for failed runs', () => {
      const summary = generateSummary(makeInput({ status: 'failed' }));
      expect(summary).toContain('itestagent rerun run-001 --failed-only');
    });

    test('does not suggest rerun for passed runs', () => {
      const summary = generateSummary(makeInput({ status: 'passed' }));
      expect(summary).not.toContain('--failed-only');
    });

    test('shows baseline delta table when present', () => {
      const summary = generateSummary(makeInput({ baselineDelta: baselineDelta() }));
      expect(summary).toContain('## Baseline 对比');
      expect(summary).toContain('+50ms');
      expect(summary).toContain('+12MB');
      expect(summary).toContain('regressed');
    });

    test('omits baseline section when no delta', () => {
      const summary = generateSummary(makeInput({ baselineDelta: undefined }));
      expect(summary).not.toContain('## Baseline 对比');
    });

    test('annotates simulator runs (ADR-011)', () => {
      const summary = generateSummary(
        makeInput({
          environment: {
            targetKind: 'simulator',
            representativeOfPhysicalDevice: false,
            comparisonScope: 'simulator_only',
            hostFingerprint: 'mac-abc',
            xcodeVersion: '16.2',
          },
          device: device({
            targetKind: 'simulator',
            runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
          }),
        }),
      );
      expect(summary).toContain('comparisonScope=simulator_only');
      expect(summary).toContain('不代表真实设备表现');
    });

    test('handles empty cases gracefully', () => {
      const summary = generateSummary(makeInput({ cases: [] }));
      expect(summary).toContain('## 结论 (Conclusion)');
      // Should not crash
    });

    test('shows correct conclusion for all statuses', () => {
      const statuses: { status: RunStatus; expected: string }[] = [
        { status: 'passed', expected: '所有测试用例通过' },
        { status: 'explored', expected: '探索执行完成' },
        { status: 'inconclusive', expected: '结果不确定' },
        { status: 'needs_assertion', expected: '缺少断言' },
        { status: 'flaky', expected: '不稳定' },
        { status: 'blocked', expected: '被阻塞' },
      ];

      for (const { status, expected } of statuses) {
        const summary = generateSummary(makeInput({ status }));
        expect(summary).toContain(expected);
      }
    });
  });

  // ── AC4: result.json content ────────────────────────────
  describe('AC4: result.json schema validation', () => {
    test('passed run validates against RunResultSchema', () => {
      const synth = new ReportSynthesizer(makeInput({ status: 'passed' }));
      const result = synth.synthesizeResult();
      expect(() => RunResultSchema.parse(result)).not.toThrow();
      expect(result.status).toBe('passed');
    });

    test('failed run validates and includes explanation', () => {
      const synth = new ReportSynthesizer(
        makeInput({
          status: 'failed',
          explanation: explanation(),
        }),
      );
      const result = synth.synthesizeResult();
      expect(result.status).toBe('failed');
      expect(result.explanation).toBeDefined();
      expect(result.explanation?.explanationType).toBe('product_regression');
    });

    test('includes all required fields (AC4)', () => {
      const synth = new ReportSynthesizer(
        makeInput({
          baselineDelta: baselineDelta(),
          explanation: explanation(),
        }),
      );
      const result = synth.synthesizeResult();

      expect(result.runId).toBe('run-001');
      expect(result.projectProfileRef).toContain('project-profile.json');
      expect(result.device.name).toBe('iPhone 15 Pro');
      expect(result.execution.backendUsed).toBe('appium');
      expect(result.metrics.launchDurationMs).toBe(850);
      expect(result.baselineDelta).toBeDefined();
      expect(result.artifactRefs).toEqual(['screenshot-001']);
      expect(result.explanation).toBeDefined();
      expect(result.environment.targetKind).toBe('physical');
    });

    test('result.json has schemaVersion 3.0', () => {
      const synth = new ReportSynthesizer(makeInput());
      const result = synth.synthesizeResult();
      expect(result.schemaVersion).toBe('3.0');
    });

    test('passed run omits explanation field', () => {
      const synth = new ReportSynthesizer(makeInput({ status: 'passed' }));
      const result = synth.synthesizeResult();
      expect(result.explanation).toBeUndefined();
    });
  });

  // ── AC5: artifact-index.json content ────────────────────
  describe('AC5: artifact-index.json', () => {
    test('validates against ArtifactIndexSchema', () => {
      const synth = new ReportSynthesizer(
        makeInput({
          allArtifacts: [
            artifactEntry({
              id: 'ss-1',
              type: 'screenshot',
              path: 'art/ss1.png',
              relatedStep: 'step-1',
            }),
            artifactEntry({
              id: 'tr-1',
              type: 'trace',
              path: 'art/trace.trace',
              relatedStep: 'step-2',
            }),
            artifactEntry({ id: 'log-1', type: 'log', path: 'art/syslog.log' }),
          ],
        }),
      );
      const idx = synth.synthesizeArtifactIndex();
      expect(() => ArtifactIndexSchema.parse(idx)).not.toThrow();
      expect(idx.artifacts.length).toBe(3);
    });

    test('artifact-index has schemaVersion 2.0', () => {
      const synth = new ReportSynthesizer(makeInput());
      const idx = synth.synthesizeArtifactIndex();
      expect(idx.schemaVersion).toBe('2.0');
    });

    test('artifact-index runId matches input', () => {
      const synth = new ReportSynthesizer(makeInput({ runId: 'run-xyz' }));
      const idx = synth.synthesizeArtifactIndex();
      expect(idx.runId).toBe('run-xyz');
    });

    test('artifact-index includes relatedStep field', () => {
      const synth = new ReportSynthesizer(
        makeInput({
          allArtifacts: [
            artifactEntry({
              id: 'a1',
              type: 'crashlog',
              path: 'crash.log',
              relatedStep: 'step-crash',
            }),
          ],
        }),
      );
      const idx = synth.synthesizeArtifactIndex();
      expect(idx.artifacts[0]?.relatedStep).toBe('step-crash');
    });
  });

  // ── G2: Schema validation ───────────────────────────────
  describe('G2: schema validation', () => {
    test('synthesizeResult output is a valid RunResult', () => {
      const synth = new ReportSynthesizer(makeInput());
      const result = synth.synthesizeResult();
      const parsed = RunResultSchema.parse(result);
      expect(parsed.runId).toBe('run-001');
    });

    test('synthesizeArtifactIndex output is a valid ArtifactIndex', () => {
      const synth = new ReportSynthesizer(makeInput());
      const idx = synth.synthesizeArtifactIndex();
      const parsed = ArtifactIndexSchema.parse(idx);
      expect(parsed.runId).toBe('run-001');
    });

    test('minimum viable input validates', () => {
      const input: ReportSynthesizerInput = {
        runId: 'run-min',
        status: 'explored',
        projectProfileRef: 'projects/hash/project-profile.json',
        device: device({ targetKind: 'physical' }),
        execution: execution({ completedSteps: 0, failedSteps: 0 }),
        cases: [],
        metrics: {},
        environment: environment(),
        artifactRefs: [],
        allArtifacts: [],
        steps: [],
      };
      const synth = new ReportSynthesizer(input);
      expect(() => RunResultSchema.parse(synth.synthesizeResult())).not.toThrow();
    });
  });

  // ── Simulator-specific ──────────────────────────────────
  describe('simulator (ADR-011)', () => {
    test('simulator environment metadata is preserved in result.json', () => {
      const synth = new ReportSynthesizer(
        makeInput({
          environment: {
            targetKind: 'simulator',
            representativeOfPhysicalDevice: false,
            comparisonScope: 'simulator_only',
            hostFingerprint: 'mac-mini-01',
            xcodeVersion: '16.2',
          },
          device: device({
            targetKind: 'simulator',
            runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
          }),
        }),
      );
      const result = synth.synthesizeResult();
      expect(result.environment.targetKind).toBe('simulator');
      expect(result.environment.representativeOfPhysicalDevice).toBe(false);
      expect(result.environment.comparisonScope).toBe('simulator_only');
      expect(result.device.targetKind).toBe('simulator');
    });
  });

  // ── Edge cases ──────────────────────────────────────────
  describe('edge cases', () => {
    test('zero metrics does not throw', () => {
      const synth = new ReportSynthesizer(makeInput({ metrics: {} }));
      expect(() => synth.synthesizeResult()).not.toThrow();
      const summary = generateSummary(makeInput({ metrics: {} }));
      expect(summary).toContain('No metrics collected');
    });

    test('empty artifacts array does not throw', () => {
      const synth = new ReportSynthesizer(
        makeInput({
          artifactRefs: [],
          allArtifacts: [],
        }),
      );
      const idx = synth.synthesizeArtifactIndex();
      expect(idx.artifacts).toEqual([]);
    });

    test('missing optional fields do not throw', () => {
      const synth = new ReportSynthesizer(
        makeInput({
          baselineDelta: undefined,
          explanation: undefined,
          testPlanName: undefined,
        }),
      );
      const result = synth.synthesizeResult();
      expect(result.baselineDelta).toBeUndefined();
      expect(result.explanation).toBeUndefined();
    });
  });
});

// ─── B09 seam: sanitizer available to report writers ───────────────

describe('B09 seam: report sanitizer module', () => {
  it('exposes default-rule text sanitization', async () => {
    const mod = await import('../src/report-sanitizer.js');
    const result = mod.sanitizeReportText('udid 12345678-1234567890ABCDEF');
    expect(result.redactions).toBe(1);
  });
});
