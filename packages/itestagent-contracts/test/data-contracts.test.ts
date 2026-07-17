import { expect, test } from 'bun:test';
import {
  ArtifactIndexSchema,
  DEFAULT_SCHEMA_VERSION,
  ExecutionSummarySchema,
  FailureExplanationSchema,
  PerformanceMetricsSchema,
  RunResultSchema,
  RunStatusSchema,
  RunStepSchema,
  TestCaseResultSchema,
  migrateV1ToV2,
  parseArtifactIndex,
  parseRunResult,
} from '../src/data-contracts.js';

// ─── Test 1: RunStatusSchema parses all 7 status values ──────

test('RunStatusSchema parses all 7 status values', () => {
  const validStatuses = [
    'passed',
    'failed',
    'explored',
    'inconclusive',
    'needs_assertion',
    'flaky',
    'blocked',
  ] as const;
  for (const status of validStatuses) {
    expect(RunStatusSchema.parse(status)).toBe(status);
  }
});

// ─── Test 2: RunStatusSchema rejects invalid status ──────────

test('RunStatusSchema rejects invalid status', () => {
  expect(() => RunStatusSchema.parse('success')).toThrow();
  expect(() => RunStatusSchema.parse('error')).toThrow();
  expect(() => RunStatusSchema.parse('PASSED')).toThrow();
  expect(() => RunStatusSchema.parse(42)).toThrow();
});

// ─── Test 3: PerformanceMetricsSchema parses complete metrics ─

test('PerformanceMetricsSchema parses complete metrics with all fields', () => {
  const result = PerformanceMetricsSchema.parse({
    launchDurationMs: 1234,
    memoryPeakMB: 156.7,
    crashDetected: false,
    hangCount: 2,
    hitchesSummary: 'low',
    fpsApproximate: 58.3,
    approximate: false,
    rawTracePath: '/tmp/trace.trace',
  });
  expect(result.launchDurationMs).toBe(1234);
  expect(result.memoryPeakMB).toBe(156.7);
  expect(result.crashDetected).toBe(false);
  expect(result.hangCount).toBe(2);
  expect(result.hitchesSummary).toBe('low');
  expect(result.fpsApproximate).toBe(58.3);
  expect(result.approximate).toBe(false);
  expect(result.rawTracePath).toBe('/tmp/trace.trace');
});

// ─── Test 4: PerformanceMetricsSchema parses minimal metrics ─

test('PerformanceMetricsSchema parses minimal metrics (empty object)', () => {
  const result = PerformanceMetricsSchema.parse({});
  expect(result.launchDurationMs).toBeUndefined();
  expect(result.memoryPeakMB).toBeUndefined();
  expect(result.crashDetected).toBeUndefined();
  expect(result.hangCount).toBeUndefined();
  expect(result.hitchesSummary).toBeUndefined();
  expect(result.fpsApproximate).toBeUndefined();
  expect(result.approximate).toBeUndefined();
  expect(result.rawTracePath).toBeUndefined();
});

// ─── Test 5: PerformanceMetricsSchema validates approximate flag ─

test('PerformanceMetricsSchema validates approximate flag for R5 compliance', () => {
  // When approximate is true, it's explicitly noted
  const withApprox = PerformanceMetricsSchema.parse({
    fpsApproximate: 55,
    approximate: true,
  });
  expect(withApprox.approximate).toBe(true);

  // When approximate is absent, it defaults to undefined (not false)
  const withoutApprox = PerformanceMetricsSchema.parse({ fpsApproximate: 60 });
  expect(withoutApprox.approximate).toBeUndefined();
});

// ─── Test 6: ExecutionSummarySchema parses valid summary ─────

test('ExecutionSummarySchema parses valid execution summary', () => {
  const result = ExecutionSummarySchema.parse({
    totalSteps: 12,
    completedSteps: 10,
    failedSteps: 1,
    skippedSteps: 1,
    durationMs: 45000,
    startTime: '2026-07-17T10:00:00.000Z',
    endTime: '2026-07-17T10:00:45.000Z',
    targetKind: 'physical',
    backendUsed: 'mobile-mcp',
    deviceId: '00008110-ABCDEF1234567890',
  });
  expect(result.totalSteps).toBe(12);
  expect(result.completedSteps).toBe(10);
  expect(result.failedSteps).toBe(1);
  expect(result.skippedSteps).toBe(1);
  expect(result.durationMs).toBe(45000);
  expect(result.backendUsed).toBe('mobile-mcp');
});

// ─── Test 7: TestCaseResultSchema parses passed test case ────

test('TestCaseResultSchema parses passed test case', () => {
  const result = TestCaseResultSchema.parse({
    caseId: 'tc-login-001',
    name: 'Login with valid credentials',
    status: 'passed',
    steps: ['step-1', 'step-2', 'step-3'],
    durationMs: 3500,
    artifacts: ['art-screenshot-1', 'art-uitree-1'],
  });
  expect(result.caseId).toBe('tc-login-001');
  expect(result.status).toBe('passed');
  expect(result.steps).toEqual(['step-1', 'step-2', 'step-3']);
  expect(result.error).toBeUndefined();
});

// ─── Test 8: TestCaseResultSchema parses failed test case ────

test('TestCaseResultSchema parses failed test case with error', () => {
  const result = TestCaseResultSchema.parse({
    caseId: 'tc-checkout-003',
    name: 'Checkout with empty cart',
    status: 'failed',
    steps: ['step-4', 'step-5'],
    durationMs: 1200,
    error: 'Element not found: #checkout-button',
    artifacts: [],
  });
  expect(result.status).toBe('failed');
  expect(result.error).toBe('Element not found: #checkout-button');
  expect(result.artifacts).toEqual([]);
});

// ─── Test 9: FailureExplanationSchema parses all 7 types ─────

test('FailureExplanationSchema parses all 7 explanation types', () => {
  const types = [
    'product_regression',
    'script_issue',
    'device_issue',
    'env_issue',
    'flaky',
    'perf_regression',
    'inconclusive',
  ] as const;
  for (const explanationType of types) {
    const result = FailureExplanationSchema.parse({
      explanationType,
      summary: `Failure classified as ${explanationType}`,
      evidence: ['log-1', 'screenshot-2'],
      suggestion: 'Try rerunning',
      confidence: 'medium',
    });
    expect(result.explanationType).toBe(explanationType);
  }
});

// ─── Test 10: RunStepSchema parses valid step with artifacts ─

test('RunStepSchema parses valid run step with artifacts', () => {
  const result = RunStepSchema.parse({
    stepId: 'step-login-tap',
    backend: 'appium',
    action: 'tap',
    target: '#login-button',
    input: { x: 0.5, y: 0.8 },
    result: { success: true },
    artifacts: ['art-screenshot-login'],
    startedAt: '2026-07-17T10:00:01.000Z',
    durationMs: 450,
  });
  expect(result.stepId).toBe('step-login-tap');
  expect(result.backend).toBe('appium');
  expect(result.action).toBe('tap');
  expect(result.artifacts).toEqual(['art-screenshot-login']);
  expect(result.safetyGate).toBeUndefined();
});

// ─── Test 11: RunStepSchema parses step with safetyGate ──────

test('RunStepSchema parses step with safetyGate', () => {
  const result = RunStepSchema.parse({
    stepId: 'step-clear-data',
    backend: 'appium',
    action: 'clear_app_data',
    target: 'com.example.app',
    input: { bundleId: 'com.example.app' },
    result: { success: true },
    artifacts: [],
    safetyGate: 'ask',
    startedAt: '2026-07-17T10:00:02.000Z',
    durationMs: 230,
  });
  expect(result.safetyGate).toBe('ask');
});

// ─── Test 12: RunResultSchema parses COMPLETE run result ─────

test('RunResultSchema parses COMPLETE run result with all fields', () => {
  const result = RunResultSchema.parse({
    schemaVersion: '2.0',
    runId: 'run-20260717-001',
    status: 'failed',
    projectProfileRef: '~/.itestagent/projects/abc123/project-profile.json',
    device: {
      udid: '00008110-ABCDEF1234567890',
      name: 'iPhone 15 Pro',
      model: 'iPhone15,2',
      osVersion: '18.2',
      targetKind: 'physical',
    },
    execution: {
      totalSteps: 8,
      completedSteps: 6,
      failedSteps: 1,
      skippedSteps: 1,
      durationMs: 28000,
      startTime: '2026-07-17T10:00:00.000Z',
      endTime: '2026-07-17T10:00:28.000Z',
      targetKind: 'physical',
      backendUsed: 'appium',
      deviceId: '00008110-ABCDEF1234567890',
    },
    cases: [
      {
        caseId: 'tc-login-001',
        name: 'Login with valid credentials',
        status: 'passed',
        steps: ['step-1', 'step-2'],
        durationMs: 3500,
        artifacts: ['art-1'],
      },
      {
        caseId: 'tc-login-002',
        name: 'Login with invalid password',
        status: 'failed',
        steps: ['step-3'],
        durationMs: 800,
        error: 'Assertion failed: expected error toast',
        artifacts: ['art-2'],
      },
    ],
    metrics: {
      launchDurationMs: 2100,
      memoryPeakMB: 145.3,
      crashDetected: false,
      hangCount: 0,
      hitchesSummary: 'low',
      approximate: false,
    },
    environment: {
      targetKind: 'physical',
      representativeOfPhysicalDevice: true,
      comparisonScope: 'physical_only',
    },
    baselineDelta: {
      baselineId: 'baseline-v1',
      runId: 'run-20260717-001',
      comparedAt: '2026-07-17T10:00:30.000Z',
      targetKind: 'physical',
      deltas: {
        launchDurationMs: 150,
        memoryPeakMB: 5.2,
        hangCount: 0,
        hitches: 'unchanged',
      },
      summary: 'unchanged',
    },
    artifactRefs: ['art-1', 'art-2', 'art-trace-1'],
    explanation: {
      explanationType: 'script_issue',
      summary: 'Login error toast selector was stale after UI update',
      evidence: ['art-2', 'log-error-toast'],
      suggestion: 'Update selector to use accessibilityIdentifier',
      confidence: 'high',
    },
  });
  expect(result.schemaVersion).toBe('2.0');
  expect(result.runId).toBe('run-20260717-001');
  expect(result.status).toBe('failed');
  expect(result.device.udid).toBe('00008110-ABCDEF1234567890');
  expect(result.cases).toHaveLength(2);
  expect(result.metrics.launchDurationMs).toBe(2100);
  expect(result.baselineDelta?.summary).toBe('unchanged');
  expect(result.explanation?.explanationType).toBe('script_issue');
});

// ─── Test 13: RunResultSchema round-trip ─────────────────────

test('RunResultSchema round-trip: parse → JSON.stringify → parse', () => {
  const original = {
    schemaVersion: '2.0',
    runId: 'run-rt-001',
    status: 'explored' as const,
    projectProfileRef: '~/.itestagent/projects/abc/profile.json',
    device: {
      udid: 'DEVICE-UDID-001',
      name: 'Test iPhone',
      model: 'iPhone15,2',
      osVersion: '18.2',
      targetKind: 'physical',
    },
    execution: {
      totalSteps: 3,
      completedSteps: 3,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 5000,
      startTime: '2026-07-17T12:00:00.000Z',
      endTime: '2026-07-17T12:00:05.000Z',
      targetKind: 'physical',
      backendUsed: 'mobile-mcp',
      deviceId: 'DEVICE-UDID-001',
    },
    cases: [],
    metrics: {},
    environment: {
      targetKind: 'physical',
      representativeOfPhysicalDevice: true,
      comparisonScope: 'physical_only',
    },
    artifactRefs: [],
  };
  const parsed = parseRunResult(original);
  expect(parsed.runId).toBe('run-rt-001');

  const serialized = JSON.stringify(parsed);
  const reparsed = parseRunResult(JSON.parse(serialized));
  expect(reparsed.schemaVersion).toBe(original.schemaVersion);
  expect(reparsed.runId).toBe(original.runId);
  expect(reparsed.status).toBe(original.status);
  expect(reparsed.device.udid).toBe(original.device.udid);
  expect(reparsed.execution.totalSteps).toBe(original.execution.totalSteps);
});

// ─── Test 14: ArtifactIndexSchema parses valid artifact index ─

test('ArtifactIndexSchema parses valid artifact index', () => {
  const result = ArtifactIndexSchema.parse({
    schemaVersion: '1.0',
    runId: 'run-20260717-001',
    artifacts: [
      {
        id: 'art-screenshot-1',
        type: 'screenshot',
        path: 'artifacts/step-1-screenshot.png',
        mimeType: 'image/png',
        sizeBytes: 245760,
        sha256: 'abc123def456',
        relatedStep: 'step-1',
        backend: 'appium',
        redactionStatus: 'safe',
      },
      {
        id: 'art-log-1',
        type: 'log',
        path: 'artifacts/syslog.txt',
        sizeBytes: 10240,
        redactionStatus: 'redacted',
      },
      {
        id: 'art-crash-1',
        type: 'crashlog',
        path: 'artifacts/crash.ips',
        redactionStatus: 'raw-local-only',
      },
    ],
  });
  expect(result.schemaVersion).toBe('1.0');
  expect(result.artifacts).toHaveLength(3);
  const art0 = result.artifacts[0];
  expect(art0).toBeDefined();
  if (art0) {
    expect(art0.type).toBe('screenshot');
    expect(art0.redactionStatus).toBe('safe');
  }
  const art2 = result.artifacts[2];
  expect(art2).toBeDefined();
  if (art2) {
    expect(art2.redactionStatus).toBe('raw-local-only');
  }
});

// ─── Test 15: ArtifactIndexSchema round-trip ─────────────────

test('ArtifactIndexSchema round-trip: parse → JSON.stringify → parse', () => {
  const original = {
    schemaVersion: '1.0',
    runId: 'run-rt-002',
    artifacts: [
      {
        id: 'art-video-1',
        type: 'video' as const,
        path: 'artifacts/recording.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 10485760,
        redactionStatus: 'safe' as const,
      },
      {
        id: 'art-trace-1',
        type: 'trace' as const,
        path: 'artifacts/perf.trace',
        redactionStatus: 'raw-local-only' as const,
      },
    ],
  };
  const parsed = parseArtifactIndex(original);
  expect(parsed.artifacts).toHaveLength(2);

  const serialized = JSON.stringify(parsed);
  const reparsed = parseArtifactIndex(JSON.parse(serialized));
  expect(reparsed.schemaVersion).toBe(original.schemaVersion);
  expect(reparsed.runId).toBe(original.runId);
  expect(reparsed.artifacts).toHaveLength(2);
  const rtArt0 = reparsed.artifacts[0];
  expect(rtArt0).toBeDefined();
  if (rtArt0) {
    expect(rtArt0.id).toBe('art-video-1');
  }
  const rtArt1 = reparsed.artifacts[1];
  expect(rtArt1).toBeDefined();
  if (rtArt1) {
    expect(rtArt1.type).toBe('trace');
  }
});

// ─── Test 16: DEFAULT_SCHEMA_VERSION equals '2.0' ────────────

test('DEFAULT_SCHEMA_VERSION equals 2.0 (ADR-011 schema v2 upgrade)', () => {
  expect(DEFAULT_SCHEMA_VERSION).toBe('2.0');
});

// ─── Test 17: migrateV1ToV2 — bumps schemaVersion ─────────────

test('migrateV1ToV2 bumps schemaVersion from 1.0 to 2.0', () => {
  const v1data = {
    schemaVersion: '1.0',
    runId: 'run-v1-001',
    status: 'passed',
    projectProfileRef: '~/.itestagent/projects/abc/profile.json',
    device: {
      udid: 'DEVICE-UDID-001',
      name: 'Test iPhone',
      model: 'iPhone15,2',
      osVersion: '18.2',
    },
    execution: {
      totalSteps: 3,
      completedSteps: 3,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 5000,
      startTime: '2026-07-17T12:00:00.000Z',
      endTime: '2026-07-17T12:00:05.000Z',
      backendUsed: 'appium',
      deviceId: 'DEVICE-UDID-001',
    },
    cases: [],
    metrics: {},
    artifactRefs: [],
  };

  const result = migrateV1ToV2(v1data);
  expect(result.schemaVersion).toBe('2.0');
});

// ─── Test 18: migrateV1ToV2 — injects targetKind=physical ────

test('migrateV1ToV2 injects targetKind=physical into device, execution, and environment', () => {
  const v1data = {
    schemaVersion: '1.0',
    runId: 'run-v1-002',
    status: 'passed',
    projectProfileRef: '~/.itestagent/projects/abc/profile.json',
    device: {
      udid: 'DEVICE-UDID-002',
      name: 'iPhone 14',
      model: 'iPhone14,7',
      osVersion: '17.5',
    },
    execution: {
      totalSteps: 5,
      completedSteps: 5,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 10000,
      startTime: '2026-07-17T13:00:00.000Z',
      endTime: '2026-07-17T13:00:10.000Z',
      backendUsed: 'appium',
      deviceId: 'DEVICE-UDID-002',
    },
    cases: [],
    metrics: {},
    artifactRefs: [],
  };

  const result = migrateV1ToV2(v1data);
  expect(result.device.targetKind).toBe('physical');
  expect(result.execution.targetKind).toBe('physical');
  expect(result.environment.targetKind).toBe('physical');
  expect(result.environment.representativeOfPhysicalDevice).toBe(true);
  expect(result.environment.comparisonScope).toBe('physical_only');
});

// ─── Test 19: migrateV1ToV2 — pass-through v2 data ────────────

test('migrateV1ToV2 passes through v2 data unchanged', () => {
  const v2data = {
    schemaVersion: '2.0',
    runId: 'run-v2-001',
    status: 'explored',
    projectProfileRef: '~/.itestagent/projects/xyz/profile.json',
    device: {
      udid: 'SIM-UDID-001',
      name: 'iPhone 15 Pro Simulator',
      model: 'iPhone15,2',
      osVersion: '18.2',
      targetKind: 'simulator',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    },
    execution: {
      totalSteps: 4,
      completedSteps: 4,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 8000,
      startTime: '2026-07-17T14:00:00.000Z',
      endTime: '2026-07-17T14:00:08.000Z',
      targetKind: 'simulator',
      backendUsed: 'appium',
      deviceId: 'SIM-UDID-001',
    },
    cases: [],
    metrics: {},
    environment: {
      targetKind: 'simulator',
      representativeOfPhysicalDevice: false,
      comparisonScope: 'simulator_only',
    },
    artifactRefs: [],
  };

  const result = migrateV1ToV2(v2data);
  expect(result.schemaVersion).toBe('2.0');
  expect(result.device.targetKind).toBe('simulator');
  expect(result.execution.targetKind).toBe('simulator');
  expect(result.environment.targetKind).toBe('simulator');
  expect(result.environment.representativeOfPhysicalDevice).toBe(false);
  expect(result.environment.comparisonScope).toBe('simulator_only');
});

// ─── Test 20: RunResultSchema parses simulator run result ─────

test('RunResultSchema parses simulator run result with environment annotations', () => {
  const result = RunResultSchema.parse({
    schemaVersion: '2.0',
    runId: 'run-sim-001',
    status: 'passed',
    projectProfileRef: '~/.itestagent/projects/abc/profile.json',
    device: {
      udid: 'ABCD-1234-EFGH-5678',
      name: 'iPhone 15 Pro Simulator',
      model: 'iPhone15,2',
      osVersion: '18.2',
      targetKind: 'simulator',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    },
    execution: {
      totalSteps: 6,
      completedSteps: 6,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 15000,
      startTime: '2026-07-17T15:00:00.000Z',
      endTime: '2026-07-17T15:00:15.000Z',
      targetKind: 'simulator',
      backendUsed: 'appium',
      deviceId: 'ABCD-1234-EFGH-5678',
    },
    cases: [],
    metrics: {
      launchDurationMs: 1800,
      approximate: true,
    },
    environment: {
      targetKind: 'simulator',
      representativeOfPhysicalDevice: false,
      comparisonScope: 'simulator_only',
    },
    artifactRefs: [],
  });
  expect(result.device.targetKind).toBe('simulator');
  expect(result.environment.representativeOfPhysicalDevice).toBe(false);
  expect(result.environment.comparisonScope).toBe('simulator_only');
});

// ─── Test 21: BaselineCompareInputSchema requires targetKind ───

test('BaselineCompareInputSchema requires targetKind for domain isolation', () => {
  const { BaselineCompareInputSchema } = require('../src/performance-backend.js');
  const valid = BaselineCompareInputSchema.parse({
    deviceId: 'DEV-001',
    current: { approximate: true },
    baselineId: 'baseline-v1',
    targetKind: 'physical',
  });
  expect(valid.targetKind).toBe('physical');

  // Missing targetKind should throw
  expect(() =>
    BaselineCompareInputSchema.parse({
      deviceId: 'DEV-001',
      current: {},
      baselineId: 'baseline-v1',
    }),
  ).toThrow();
});
