/**
 * Phase 4 integration — Schema contract round-trips (P2).
 *
 * Validates that all Phase 4 Zod schemas accept valid data and reject invalid data.
 */
import { describe, expect, it } from 'bun:test';

import {
  ArtifactIndexSchema,
  BaselineDeltaSchema,
  BaselineRecordSchema,
  FailureExplanationSchema,
  PerformanceMetricsSchema,
  RunResultSchema,
  TraceSummarySchema,
  buildBaselineKey,
} from 'itestagent-contracts';

const NOW = new Date().toISOString();

describe('Phase 4 Schema Contracts', () => {
  describe('TraceSummarySchema', () => {
    it('accepts valid physical trace summary', () => {
      const result = TraceSummarySchema.safeParse({
        launchDurationMs: 1200,
        memoryPeakMB: 256,
        hangCount: 2,
        fpsApproximate: 55,
        hitchesSummary: { totalHitchDurationMs: 150 },
        approximate: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts minimal summary with approximate marker', () => {
      const result = TraceSummarySchema.safeParse({ approximate: true });
      expect(result.success).toBe(true);
    });

    it('rejects negative launchDurationMs', () => {
      const result = TraceSummarySchema.safeParse({
        launchDurationMs: -100,
        approximate: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative fpsApproximate', () => {
      const result = TraceSummarySchema.safeParse(makeTraceSummary({ fpsApproximate: -5 }));
      expect(result.success).toBe(false);
    });
  });

  describe('PerformanceMetricsSchema', () => {
    it('accepts valid metrics', () => {
      const result = PerformanceMetricsSchema.safeParse({
        launchDurationMs: 800,
        memoryPeakMB: 180,
        fpsApproximate: 60,
        approximate: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts metrics without approximate (optional field)', () => {
      const result = PerformanceMetricsSchema.safeParse({ launchDurationMs: 800 });
      expect(result.success).toBe(true);
    });
  });

  describe('BaselineRecordSchema', () => {
    it('accepts valid physical baseline record', () => {
      const record = {
        schemaVersion: 2 as const,
        key: buildBaselineKey({
          projectId: 'myapp',
          targetKind: 'physical',
          deviceModel: 'iPhone16,2',
          iosVersion: '18.2',
          scenario: 'login-smoke',
        }),
        targetKind: 'physical' as const,
        launchDurationMs: 1000,
        memoryPeakMB: 200,
        approximate: true,
        updatedFromRun: 'run-001',
        createdAt: NOW,
        updatedAt: NOW,
        reachableRuns: ['run-001'],
      };
      const result = BaselineRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it('accepts valid simulator baseline with optional metadata', () => {
      const record = {
        schemaVersion: 2 as const,
        key: buildBaselineKey({
          projectId: 'myapp',
          targetKind: 'simulator',
          deviceModel: 'iPhone17,1',
          iosVersion: '18.2',
          scenario: 'smoke',
        }),
        targetKind: 'simulator' as const,
        launchDurationMs: 1500,
        hangCount: 0,
        approximate: true,
        updatedFromRun: 'run-sim-001',
        createdAt: NOW,
        updatedAt: NOW,
        reachableRuns: ['run-sim-001'],
        comparisonScope: 'simulator_only' as const,
        representativeOfPhysicalDevice: false as const,
        hostFingerprint: 'macOS-15.2-arm64',
        xcodeVersion: '16.5',
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
      };
      const result = BaselineRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it('rejects unknown extra fields (strict)', () => {
      const result = BaselineRecordSchema.safeParse({
        schemaVersion: 2,
        key: 'myapp|physical|iPhone16,2|18.0|smoke',
        targetKind: 'physical',
        approximate: true,
        updatedFromRun: 'run-001',
        createdAt: NOW,
        updatedAt: NOW,
        reachableRuns: ['run-001'],
        fakeField: 'should-not-be-here',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('BaselineDeltaSchema', () => {
    it('accepts valid baseline delta with all deltas', () => {
      const result = BaselineDeltaSchema.safeParse({
        baselineId: 'myapp|physical|iPhone16,2|18.2|smoke',
        runId: 'run-002',
        comparedAt: NOW,
        targetKind: 'physical',
        summary: 'regressed',
        deltas: {
          launchDurationMs: 200,
          memoryPeakMB: 50,
          hangCount: 1,
          fpsApproximate: -5,
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts delta with no measurable changes', () => {
      const result = BaselineDeltaSchema.safeParse({
        baselineId: 'myapp|simulator|iPhone17,1|18.2|smoke',
        runId: 'run-002',
        comparedAt: NOW,
        targetKind: 'simulator',
        summary: 'unchanged',
        deltas: {},
      });
      expect(result.success).toBe(true);
    });
  });

  describe('FailureExplanationSchema', () => {
    it('accepts product regression explanation', () => {
      const result = FailureExplanationSchema.safeParse({
        explanationType: 'product_regression',
        summary: 'App crashed with SIGABRT',
        evidence: ['crash-1'],
        confidence: 'high',
        suggestedActions: ['Check backtrace', 'Run memory profiler'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts inconclusive explanation', () => {
      const result = FailureExplanationSchema.safeParse({
        explanationType: 'inconclusive',
        summary: 'Unable to determine root cause',
        evidence: [],
        confidence: 'low',
      });
      expect(result.success).toBe(true);
    });

    it('accepts performance regression explanation', () => {
      const result = FailureExplanationSchema.safeParse({
        explanationType: 'perf_regression',
        summary: 'Memory peak exceeded threshold',
        evidence: ['trace-1'],
        confidence: 'medium',
        suggestedActions: ['Run Instruments to profile allocations', 'Check for retain cycles'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid confidence value', () => {
      const result = FailureExplanationSchema.safeParse({
        explanationType: 'inconclusive',
        summary: 'test',
        evidence: [],
        confidence: 'unknown_value',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RunResultSchema', () => {
    it('accepts valid failed run result', () => {
      const result = RunResultSchema.safeParse({
        schemaVersion: '3.0',
        runId: 'run-001',
        status: 'failed',
        projectProfileRef: 'projects/abc/profile.json',
        device: {
          udid: 'DEVICE-UDID',
          name: 'iPhone 15 Pro',
          model: 'iPhone16,1',
          osVersion: '18.2',
          targetKind: 'physical',
        },
        execution: {
          mode: 'device_backend',
          totalSteps: 5,
          completedSteps: 2,
          failedSteps: 3,
          skippedSteps: 0,
          durationMs: 12000,
          startTime: NOW,
          endTime: NOW,
          targetKind: 'physical',
          backendUsed: 'appium',
          deviceId: 'DEVICE-UDID',
        },
        cases: [],
        metrics: { approximate: true },
        environment: {
          targetKind: 'physical',
          representativeOfPhysicalDevice: true,
          comparisonScope: 'physical_only',
        },
        artifactRefs: ['art-1'],
        explanation: {
          explanationType: 'product_regression',
          summary: 'App crashed',
          evidence: ['art-1'],
          confidence: 'high',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid simulator run result', () => {
      const result = RunResultSchema.safeParse({
        schemaVersion: '3.0',
        runId: 'run-sim-001',
        status: 'passed',
        projectProfileRef: 'projects/abc/profile.json',
        device: {
          udid: 'SIM-UDID',
          name: 'iPhone 16 Pro',
          model: 'iPhone17,1',
          osVersion: '18.2',
          targetKind: 'simulator',
          runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
        },
        execution: {
          mode: 'xcuitest',
          totalSteps: 0,
          completedSteps: 0,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 5000,
          startTime: NOW,
          endTime: NOW,
          targetKind: 'simulator',
          backendUsed: 'xcodebuild',
          deviceId: 'SIM-UDID',
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
        artifactRefs: [],
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid run status', () => {
      const result = RunResultSchema.safeParse({
        schemaVersion: '3.0',
        runId: 'run-001',
        status: 'not-a-real-status',
        projectProfileRef: 'x',
        device: { udid: 'x', name: 'x', model: 'x', osVersion: 'x', targetKind: 'physical' },
        execution: {
          mode: 'device_backend',
          totalSteps: 0,
          completedSteps: 0,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 0,
          startTime: NOW,
          endTime: NOW,
          targetKind: 'physical',
          backendUsed: 'mock',
          deviceId: 'x',
        },
        cases: [],
        metrics: { approximate: true },
        environment: {
          targetKind: 'physical',
          representativeOfPhysicalDevice: true,
          comparisonScope: 'physical_only',
        },
        artifactRefs: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ArtifactIndexSchema', () => {
    it('accepts valid artifact index', () => {
      const result = ArtifactIndexSchema.safeParse({
        schemaVersion: '2.0',
        runId: 'run-001',
        artifacts: [
          {
            id: 'art-1',
            type: 'screenshot',
            path: 'artifacts/screenshot.png',
            mimeType: 'image/png',
            sizeBytes: 102400,
            redactionStatus: 'redacted',
            relatedStep: 'step-1',
          },
          {
            id: 'art-2',
            type: 'crashlog',
            path: 'artifacts/crashlog.txt',
            sizeBytes: 4096,
            redactionStatus: 'raw-local-only',
            backend: 'appium',
          },
        ],
        collectionOutcomes: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty artifact list', () => {
      const result = ArtifactIndexSchema.safeParse({
        schemaVersion: '2.0',
        runId: 'run-empty',
        artifacts: [],
        collectionOutcomes: [],
      });
      expect(result.success).toBe(true);
    });
  });

  it('BaselineRecord survives JSON round-trip', () => {
    const record = {
      schemaVersion: 2 as const,
      key: 'myapp|physical|iPhone16,2|18.2|login-smoke',
      targetKind: 'physical' as const,
      launchDurationMs: 1000,
      memoryPeakMB: 200,
      hangCount: 0,
      approximate: true,
      updatedFromRun: 'run-001',
      createdAt: NOW,
      updatedAt: NOW,
      reachableRuns: ['run-001'],
    };
    const json = JSON.stringify(record);
    const parsed = BaselineRecordSchema.parse(JSON.parse(json));
    expect(parsed.key).toBe(record.key);
    expect(parsed.launchDurationMs).toBe(1000);
  });

  it('RunResult survives JSON round-trip', () => {
    const runResult = {
      schemaVersion: '3.0',
      runId: 'run-roundtrip',
      status: 'explored' as const,
      projectProfileRef: 'projects/abc/profile.json',
      device: {
        udid: 'UDID',
        name: 'Test',
        model: 'iPhone99,1',
        osVersion: '99.0',
        targetKind: 'physical' as const,
      },
      execution: {
        mode: 'device_backend' as const,
        totalSteps: 1,
        completedSteps: 0,
        failedSteps: 0,
        skippedSteps: 0,
        durationMs: 5000,
        startTime: NOW,
        endTime: NOW,
        targetKind: 'physical' as const,
        backendUsed: 'mock',
        deviceId: 'UDID',
      },
      cases: [],
      metrics: { approximate: true },
      environment: {
        targetKind: 'physical' as const,
        representativeOfPhysicalDevice: true,
        comparisonScope: 'physical_only' as const,
      },
      artifactRefs: [],
    };
    const json = JSON.stringify(runResult);
    const parsed = RunResultSchema.parse(JSON.parse(json));
    expect(parsed.runId).toBe('run-roundtrip');
    expect(parsed.status).toBe('explored');
  });
});

function makeTraceSummary(
  overrides?: Partial<{
    launchDurationMs: number;
    memoryPeakMB: number;
    hangCount: number;
    fpsApproximate: number;
    approximate: boolean;
    totalSamples?: number;
    hitchesSummary?: unknown;
    crashDetected?: boolean;
  }>,
): {
  launchDurationMs: number;
  memoryPeakMB: number;
  hangCount: number;
  fpsApproximate: number;
  approximate: boolean;
  totalSamples?: number;
  hitchesSummary?: unknown;
  crashDetected?: boolean;
} {
  return {
    launchDurationMs: 1200,
    memoryPeakMB: 256,
    hangCount: 2,
    fpsApproximate: 55,
    approximate: true,
    ...overrides,
  };
}
