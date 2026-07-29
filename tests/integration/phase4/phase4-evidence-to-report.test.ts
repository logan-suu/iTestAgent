/**
 * Phase 4 integration — Evidence → Explanation → Report full pipeline.
 *
 * Verifies the end-to-end chain from failure evidence collection through
 * failure explanation to the three-piece report synthesis.
 *
 * P0: EvidenceCollector → FailureExplainer → ReportSynthesizer
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ArtifactInput,
  ArtifactRef,
  ArtifactStore,
  BaselineDelta,
  RunStatus,
  RunStep,
} from 'itestagent-contracts';
import {
  ArtifactIndexSchema,
  FailureExplanationSchema,
  RunResultSchema,
} from 'itestagent-contracts';

import { EvidenceCollector, FailureExplainer } from 'itestagent-engine';
import type { EvidenceOptions, ExplainContext } from 'itestagent-engine';

import { ReportSynthesizer } from 'itestagent-report';

function mockArtifactStore(): ArtifactStore {
  const artifacts = new Map<string, ArtifactRef>();
  let nextId = 0;
  return {
    async put(input: ArtifactInput): Promise<ArtifactRef> {
      const ref: ArtifactRef = {
        id: `mock_${nextId++}_${Date.now()}`,
        type: input.type,
        path: input.path ?? `artifacts/mock_${input.type}.bin`,
        mimeType: input.mimeType,
        relatedStep: input.relatedStep,
        backend: input.backend,
        redactionStatus: 'raw-local-only',
      };
      artifacts.set(ref.id, ref);
      return ref;
    },
    async get(id: string): Promise<ArtifactRef | null> {
      return artifacts.get(id) ?? null;
    },
    async search(_query: string): Promise<ArtifactRef[]> {
      return [...artifacts.values()];
    },
  };
}

const NOW = new Date().toISOString();

function makeFailedSteps(): RunStep[] {
  return [
    {
      stepId: 'step-1',
      backend: 'appium',
      action: 'tap',
      target: 'Login button',
      input: { x: 0.5, y: 0.5 },
      result: { error: 'Element not found: Login button' },
      artifacts: [],
      startedAt: NOW,
      durationMs: 500,
    },
    {
      stepId: 'step-2',
      backend: 'appium',
      action: 'launchApp',
      target: 'com.example.app',
      input: { bundleId: 'com.example.app' },
      result: { error: 'App crashed on launch' },
      artifacts: [],
      startedAt: NOW,
      durationMs: 2000,
    },
  ];
}

function makeExplainContext(
  evidence: ArtifactRef[],
  overrides?: Partial<ExplainContext>,
): ExplainContext {
  return {
    runId: 'run-001',
    status: 'failed',
    projectProfileRef: 'projects/abc/profile.json',
    testPlanName: 'login-smoke',
    steps: makeFailedSteps(),
    evidence,
    targetKind: 'physical',
    ...overrides,
  };
}

function makeBaselineDelta(): BaselineDelta {
  return {
    baselineId: 'myapp|physical|iPhone16,2|18.2|login-smoke',
    runId: 'run-001',
    comparedAt: NOW,
    targetKind: 'physical',
    deltas: { launchDurationMs: 120 },
    summary: 'regressed',
  };
}

describe('Phase 4 Evidence → Explanation → Report', () => {
  it('ReportSynthesizer produces valid result.json (G2)', () => {
    const synth = new ReportSynthesizer({
      runId: 'run-e2e-001',
      status: 'failed' as RunStatus,
      projectProfileRef: 'projects/abc/profile.json',
      device: {
        udid: '00008110-TESTDEVICE',
        name: 'iPhone 15 Pro',
        model: 'iPhone16,1',
        osVersion: '18.2',
        targetKind: 'physical',
      },
      execution: {
        totalSteps: 5,
        completedSteps: 2,
        failedSteps: 3,
        skippedSteps: 0,
        durationMs: 12000,
        startTime: NOW,
        endTime: NOW,
        mode: 'device_backend',
        targetKind: 'physical',
        backendUsed: 'appium',
        deviceId: '00008110-TESTDEVICE',
      },
      cases: [],
      metrics: { approximate: true },
      environment: {
        targetKind: 'physical',
        representativeOfPhysicalDevice: true,
        comparisonScope: 'physical_only',
      },
      baselineDelta: makeBaselineDelta(),
      artifactRefs: ['artifact-1', 'artifact-2'],
      allArtifacts: [
        {
          id: 'artifact-1',
          type: 'screenshot',
          path: 'artifacts/screenshot.png',
          redactionStatus: 'raw-local-only',
        },
        {
          id: 'artifact-2',
          type: 'crashlog',
          path: 'artifacts/crashlog.txt',
          redactionStatus: 'raw-local-only',
        },
      ],
      explanation: {
        explanationType: 'product_regression',
        summary: 'App crashed with SIGABRT during tap on Login button',
        evidence: ['artifact-2'],
        confidence: 'high',
        suggestedActions: ['Check crashlog for backtrace', 'Verify memory usage'],
      },
      steps: makeFailedSteps(),
      testPlanName: 'login-smoke',
    });

    const result = synth.synthesizeResult();
    const parsed = RunResultSchema.parse(result);
    expect(parsed.status).toBe('failed');
    expect(parsed.baselineDelta?.baselineId).toContain('login-smoke');
    expect(parsed.explanation?.explanationType).toBe('product_regression');
  });

  it('ReportSynthesizer produces valid artifact-index.json (G2)', () => {
    const synth = new ReportSynthesizer({
      runId: 'run-e2e-002',
      status: 'explored' as RunStatus,
      projectProfileRef: 'projects/abc/profile.json',
      device: {
        udid: 'SIM-UDID-TEST',
        name: 'iPhone 16 Pro',
        model: 'iPhone17,1',
        osVersion: '18.2',
        targetKind: 'simulator',
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
      },
      execution: {
        totalSteps: 0,
        completedSteps: 0,
        failedSteps: 0,
        skippedSteps: 0,
        durationMs: 5000,
        startTime: NOW,
        endTime: NOW,
        mode: 'xcuitest',
        targetKind: 'simulator',
        backendUsed: 'xcodebuild',
        deviceId: 'SIM-UDID-TEST',
      },
      cases: [],
      metrics: { approximate: true },
      environment: {
        targetKind: 'simulator',
        representativeOfPhysicalDevice: false,
        comparisonScope: 'simulator_only',
        hostFingerprint: 'macOS-15.2-arm64',
        xcodeVersion: '16.5',
      },
      artifactRefs: ['art-a', 'art-b', 'art-c'],
      allArtifacts: [
        {
          id: 'art-a',
          type: 'screenshot',
          path: 'artifacts/screenshot.png',
          sizeBytes: 102400,
          redactionStatus: 'redacted',
          relatedStep: 'step-1',
        },
        {
          id: 'art-b',
          type: 'trace',
          path: 'artifacts/trace.xctrace',
          sizeBytes: 5000000,
          redactionStatus: 'raw-local-only',
          backend: 'xctrace-analyzer-core',
        },
        {
          id: 'art-c',
          type: 'log',
          path: 'artifacts/syslog.txt',
          sizeBytes: 2048,
          redactionStatus: 'safe',
          backend: 'simctl',
        },
      ],
      steps: [],
      testPlanName: 'smoke',
    });

    const idx = synth.synthesizeArtifactIndex();
    const parsed = ArtifactIndexSchema.parse(idx);
    expect(parsed.runId).toBe('run-e2e-002');
    expect(parsed.artifacts.length).toBe(3);
    expect(parsed.artifacts[0]?.type).toBe('screenshot');
    expect(parsed.artifacts[1]?.backend).toBe('xctrace-analyzer-core');
  });

  it('ReportSynthesizer produces summary.md with all sections', () => {
    const synth = new ReportSynthesizer({
      runId: 'run-summary-001',
      status: 'failed' as RunStatus,
      projectProfileRef: 'projects/abc/profile.json',
      device: {
        udid: 'DEVICE-ID',
        name: 'iPhone 14 Plus',
        model: 'iPhone14,8',
        osVersion: '18.2.1',
        targetKind: 'physical',
      },
      execution: {
        totalSteps: 3,
        completedSteps: 1,
        failedSteps: 2,
        skippedSteps: 0,
        durationMs: 8000,
        startTime: NOW,
        endTime: NOW,
        targetKind: 'physical',
        backendUsed: 'appium',
        deviceId: 'DEVICE-ID',
      },
      cases: [],
      metrics: {
        launchDurationMs: 1200,
        memoryPeakMB: 256,
        approximate: true,
      },
      environment: {
        targetKind: 'physical',
        representativeOfPhysicalDevice: true,
        comparisonScope: 'physical_only',
      },
      baselineDelta: makeBaselineDelta(),
      artifactRefs: ['art-1'],
      allArtifacts: [
        {
          id: 'art-1',
          type: 'crashlog',
          path: 'artifacts/crashlog.txt',
          redactionStatus: 'raw-local-only',
        },
      ],
      explanation: {
        explanationType: 'perf_regression',
        summary: 'Launch duration regressed by 120ms compared to baseline',
        evidence: ['art-1'],
        confidence: 'medium',
        suggestedActions: [
          'Run Instruments to profile launch',
          'Check for main-thread blocking during startup',
        ],
      },
      steps: makeFailedSteps(),
      testPlanName: 'regression',
    });

    const summary = synth.synthesizeSummary();
    expect(summary).toContain('# iTestAgent Run Report');
    expect(summary).toContain('run-summary-001');
    expect(summary).toContain('Failed');
    expect(summary).toContain('iPhone 14 Plus');
    expect(summary).toContain('结论');
    expect(summary).toContain('失败原因');
    expect(summary).toContain('关键指标');
    expect(summary).toContain('perf_regression');
  });

  it('ReportSynthesizer.write writes three files to disk', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'itestagent-phase4-report-'));
    const runDir = join(tmpRoot, 'runs', 'run-write-001');
    try {
      const synth = new ReportSynthesizer({
        runId: 'run-write-001',
        status: 'passed' as RunStatus,
        projectProfileRef: 'projects/abc/profile.json',
        device: {
          udid: 'WRITE-UDID',
          name: 'Test Device',
          model: 'iPhone99,1',
          osVersion: '99.0',
          targetKind: 'physical',
        },
        execution: {
          totalSteps: 1,
          completedSteps: 1,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 1000,
          startTime: NOW,
          endTime: NOW,
          targetKind: 'physical',
          backendUsed: 'appium',
          deviceId: 'WRITE-UDID',
        },
        cases: [],
        metrics: { approximate: true },
        environment: {
          targetKind: 'physical',
          representativeOfPhysicalDevice: true,
          comparisonScope: 'physical_only',
        },
        artifactRefs: [],
        allArtifacts: [],
        steps: [],
      });

      const { resultPath, artifactIndexPath, summaryPath } = await synth.write(runDir);

      expect(existsSync(resultPath)).toBe(true);
      expect(existsSync(artifactIndexPath)).toBe(true);
      expect(existsSync(summaryPath)).toBe(true);

      const resultContent = JSON.parse(readFileSync(resultPath, 'utf-8'));
      expect(resultContent.runId).toBe('run-write-001');
      expect(resultContent.status).toBe('passed');

      const summaryContent = readFileSync(summaryPath, 'utf-8');
      expect(summaryContent).toContain('run-write-001');

      const idxContent = JSON.parse(readFileSync(artifactIndexPath, 'utf-8'));
      expect(idxContent.runId).toBe('run-write-001');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('FailureExplainer detects crashlog evidence', async () => {
    const explainer = new FailureExplainer();
    const evidence: ArtifactRef[] = [
      {
        id: 'crash-1',
        type: 'crashlog',
        path: 'artifacts/crashlog.txt',
        redactionStatus: 'raw-local-only',
      },
    ];
    const ctx = makeExplainContext(evidence);
    const explanation = await explainer.explain(ctx);

    expect(explanation.explanationType).toBe('product_regression');
    expect(explanation.confidence).toBe('high');
    expect(FailureExplanationSchema.safeParse(explanation).success).toBe(true);
  });

  it('FailureExplainer detects device offline error', async () => {
    const explainer = new FailureExplainer();
    const steps: RunStep[] = [
      {
        stepId: 's1',
        backend: 'appium',
        action: 'tap',
        target: 'Button',
        input: { x: 0.5, y: 0.5 },
        result: { error: 'device offline: no device connected' },
        artifacts: [],
        startedAt: NOW,
        durationMs: 100,
      },
    ];
    const ctx: ExplainContext = {
      runId: 'run-dev-offline',
      status: 'failed',
      projectProfileRef: 'projects/abc/profile.json',
      steps,
      evidence: [],
      targetKind: 'physical',
    };
    const explanation = await explainer.explain(ctx);
    expect(explanation.explanationType).toBe('device_issue');
    expect(explanation.summary.toLowerCase()).toContain('device');
  });

  it('FailureExplainer returns inconclusive when no rules match', async () => {
    const explainer = new FailureExplainer();
    const ctx: ExplainContext = {
      runId: 'run-mystery',
      status: 'failed',
      projectProfileRef: 'projects/abc/profile.json',
      steps: [],
      evidence: [],
      targetKind: 'physical',
    };
    const explanation = await explainer.explain(ctx);
    expect(explanation.explanationType).toBe('inconclusive');
    expect(explanation.confidence).toBe('low');
  });

  it('EvidenceCollector collects evidence on simulator failure', async () => {
    const collector = new EvidenceCollector({ throwOnError: false });
    const store = mockArtifactStore();
    const options: EvidenceOptions = {
      deviceId: 'sim-udid',
      targetKind: 'simulator',
      stepId: 'step-sim',
      runDir: join(tmpdir(), 'itestagent-phase4-evidence-sim'),
      backendName: 'mock',
      bundleId: 'com.example.app',
    };
    const summary = await collector.collectOnFailure(store, options);
    expect(summary.stepId).toBe('step-sim');
    expect(summary.results.length).toBeGreaterThan(0);
    expect(summary.totalTypes).toBeGreaterThan(0);
  });

  it('EvidenceCollector collects evidence on physical target gracefully', async () => {
    const collector = new EvidenceCollector({ throwOnError: false });
    const store = mockArtifactStore();
    const options: EvidenceOptions = {
      deviceId: 'physical-udid',
      targetKind: 'physical',
      stepId: 'step-physical',
      runDir: join(tmpdir(), 'itestagent-phase4-evidence-physical'),
      backendName: 'mock',
      bundleId: 'com.example.app',
    };
    const summary = await collector.collectOnFailure(store, options);
    expect(summary.stepId).toBe('step-physical');
    expect(summary.results.length).toBeGreaterThanOrEqual(0);
  });
});
