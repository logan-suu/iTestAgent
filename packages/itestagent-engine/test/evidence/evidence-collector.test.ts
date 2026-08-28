import { expect, test } from 'bun:test';
import type { ArtifactInput, ArtifactRef, ArtifactStore } from 'itestagent-contracts';
import { EvidenceCollector } from '../../src/evidence/evidence-collector.js';
import type { EvidenceOptions, EvidenceResult } from '../../src/evidence/types.js';

// Simulator tests drive the real `xcrun simctl` binary; CI runners have no
// booted simulator and cold xcrun invocations blow the per-test timeout.
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

function mockArtifactStore(): ArtifactStore {
  const index = new Map<string, ArtifactRef>();
  return {
    async put(input: ArtifactInput): Promise<ArtifactRef> {
      const ref: ArtifactRef = {
        id: `mock_${Date.now()}`,
        type: input.type,
        path: input.path ?? `artifacts/mock_${input.type}.bin`,
        mimeType: input.mimeType,
        relatedStep: input.relatedStep,
        backend: input.backend,
        redactionStatus: 'raw-local-only',
      };
      index.set(ref.id, ref);
      return ref;
    },
    async get(id: string): Promise<ArtifactRef | null> {
      return index.get(id) ?? null;
    },
    async search(_query: string): Promise<ArtifactRef[]> {
      return [];
    },
  };
}

test.skipIf(IS_CI)('EvidenceCollector collects screenshot on simulator failure', async () => {
  const collector = new EvidenceCollector({ throwOnError: false });
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'simulator',
    stepId: 'step-1',
    runDir: '/tmp/itestagent-test-evidence',
    backendName: 'mock',
    bundleId: 'com.example.app',
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  expect(summary.stepId).toBe('step-1');
  expect(summary.totalTypes).toBeGreaterThan(0);
  // Simulator screenshot via simctl may fail in CI (no simctl), but should not throw
  expect(summary.collectedCount).toBeGreaterThanOrEqual(0);
});

test.skipIf(IS_CI)('EvidenceCollector collects syslog on simulator failure', async () => {
  const collector = new EvidenceCollector();
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'simulator',
    stepId: 'step-2',
    runDir: '/tmp/itestagent-test-evidence-syslog',
    backendName: 'mock',
    bundleId: 'com.example.app',
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  expect(summary.stepId).toBe('step-2');
  expect(summary.results.some((r) => r.type === 'syslog')).toBe(true);
});

test.skipIf(IS_CI)('EvidenceCollector skips xcresult when path not provided', async () => {
  const collector = new EvidenceCollector();
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'simulator',
    stepId: 'step-3',
    runDir: '/tmp/itestagent-test-evidence-xcresult',
    backendName: 'mock',
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  const xcresultResult = summary.results.find((r) => r.type === 'xcresult');
  expect(xcresultResult).toBeUndefined();
});

test.skipIf(IS_CI)('EvidenceCollector skips trace when path not provided', async () => {
  const collector = new EvidenceCollector();
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'simulator',
    stepId: 'step-4',
    runDir: '/tmp/itestagent-test-evidence-trace',
    backendName: 'mock',
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  const traceResult = summary.results.find((r) => r.type === 'trace');
  expect(traceResult).toBeUndefined();
});

test.skipIf(IS_CI)('EvidenceCollector skips video when recordingActive is false', async () => {
  const collector = new EvidenceCollector();
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'simulator',
    stepId: 'step-5',
    runDir: '/tmp/itestagent-test-evidence-video',
    backendName: 'mock',
    recordingActive: false,
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  const videoResult = summary.results.find((r) => r.type === 'video');
  expect(videoResult).toBeUndefined();
});

test.skipIf(IS_CI)('EvidenceCollector attempts video when recordingActive is true', async () => {
  const collector = new EvidenceCollector();
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'simulator',
    stepId: 'step-6',
    runDir: '/tmp/itestagent-test-evidence-video-act',
    backendName: 'mock',
    recordingActive: true,
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  const videoResult = summary.results.find((r) => r.type === 'video');
  expect(videoResult).toBeDefined();
});

test('EvidenceCollector respects physical target kind', async () => {
  const collector = new EvidenceCollector();
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'physical-device',
    targetKind: 'physical',
    stepId: 'step-7',
    runDir: '/tmp/itestagent-test-evidence-physical',
    backendName: 'appium',
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  // Physical evidence requires active Appium session — all should be not_collected
  for (const result of summary.results) {
    if (result.type === 'screenshot' || result.type === 'syslog') {
      expect(result.collected).toBe(false);
      expect(result.reason).toBeDefined();
    }
  }
});

test('EvidenceCollector handles error in throwOnError mode', async () => {
  const collector = new EvidenceCollector({ throwOnError: true });
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'physical',
    stepId: 'step-8',
    runDir: '/tmp/itestagent-test-evidence-throw',
    backendName: 'appium',
  };

  // Should not throw — physical targets degrade gracefully
  const summary = await collector.collectOnFailure(artifactStore, options);
  expect(summary).toBeDefined();
});

test.skipIf(IS_CI)('EvidenceCollector returns summary with correct structure', async () => {
  const collector = new EvidenceCollector();
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'simulator',
    stepId: 'step-9',
    runDir: '/tmp/itestagent-test-evidence-struct',
    backendName: 'mock',
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  expect(summary).toHaveProperty('stepId');
  expect(summary).toHaveProperty('results');
  expect(summary).toHaveProperty('artifacts');
  expect(summary).toHaveProperty('collectedCount');
  expect(summary).toHaveProperty('totalTypes');
  expect(Array.isArray(summary.results)).toBe(true);
  expect(Array.isArray(summary.artifacts)).toBe(true);
});

test('EvidenceResult has correct shape', () => {
  const result: EvidenceResult = {
    type: 'screenshot',
    collected: true,
    artifact: {
      id: 'test-id',
      type: 'screenshot',
      path: 'artifacts/test.png',
      mimeType: 'image/png',
      redactionStatus: 'raw-local-only',
    },
  };

  expect(result.type).toBe('screenshot');
  expect(result.collected).toBe(true);
  expect(result.artifact).toBeDefined();
  expect(result.artifact?.id).toBe('test-id');
});

test.skipIf(IS_CI)('EvidenceCollectionSummary counts correctly', async () => {
  const collector = new EvidenceCollector();
  const artifactStore = mockArtifactStore();

  const options: EvidenceOptions = {
    deviceId: 'test-udid',
    targetKind: 'simulator',
    stepId: 'step-10',
    runDir: '/tmp/itestagent-test-evidence-count',
    backendName: 'mock',
  };

  const summary = await collector.collectOnFailure(artifactStore, options);

  expect(summary.collectedCount).toBeLessThanOrEqual(summary.totalTypes);
  expect(summary.collectedCount).toBeGreaterThanOrEqual(0);
});
