import { describe, expect, test } from 'bun:test';
import {
  ArtifactIndexSchema,
  FlowReplayPlanSchema,
  RunResultSchema,
  RunStepsDocumentSchema,
  parseValidatedRunBundle,
  validateRunBundleDocuments,
} from '../src/index.js';
import { makeValidTestPlan } from './test-plan.fixture.js';

const runId = 'run_t68_contract';

function steps() {
  return RunStepsDocumentSchema.parse({
    schemaVersion: 'itestagent.run-steps.v1',
    runId,
    steps: [
      {
        stepId: 'step-1',
        sequence: 1,
        backend: 'xcodebuild',
        targetKind: 'simulator',
        action: 'xcodebuild_test',
        input: {},
        result: { exitCode: 0 },
        status: 'completed',
        artifacts: ['xcresult-1'],
        startedAt: '2026-09-03T00:00:00.000Z',
        durationMs: 100,
      },
    ],
  });
}

function result(projectProfileRef?: string, mode: 'xcuitest' | 'device_backend' = 'xcuitest') {
  return RunResultSchema.parse({
    schemaVersion: '3.0',
    runId,
    status: 'passed',
    ...(projectProfileRef ? { projectProfileRef } : {}),
    device: {
      udid: 'SIM-1',
      name: 'iPhone Simulator',
      model: 'iPhone17,1',
      osVersion: '18.2',
      targetKind: 'simulator',
    },
    execution: {
      mode,
      totalSteps: 1,
      completedSteps: 1,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 100,
      startTime: '2026-09-03T00:00:00.000Z',
      endTime: '2026-09-03T00:00:00.100Z',
      targetKind: 'simulator',
      backendUsed: mode === 'device_backend' ? 'appium' : 'xcodebuild',
      deviceId: 'SIM-1',
    },
    cases: [
      {
        caseId: 'case-1',
        name: 'Example test',
        status: 'passed',
        steps: [],
        durationMs: 50,
        artifacts: [],
      },
    ],
    metrics: {},
    environment: {
      targetKind: 'simulator',
      representativeOfPhysicalDevice: false,
      comparisonScope: 'simulator_only',
    },
    artifactRefs: ['xcresult-1'],
  });
}

function index() {
  return ArtifactIndexSchema.parse({
    schemaVersion: '2.0',
    runId,
    artifacts: [
      {
        id: 'xcresult-1',
        type: 'xcresult',
        path: 'artifacts/Test.xcresult',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        relatedStep: 'step-1',
        redactionStatus: 'raw-local-only',
      },
    ],
    collectionOutcomes: [
      {
        type: 'xcresult',
        status: 'collected',
        reasonCode: 'collected',
        artifactId: 'xcresult-1',
        relatedStep: 'step-1',
      },
    ],
  });
}

function flowPlan() {
  return FlowReplayPlanSchema.parse({
    schemaVersion: 'itestagent.flow-replay-plan.v1',
    runId,
    flow: {
      flowId: 'login',
      source: 'global',
      sourcePath: '/tmp/login.yaml',
      sha256: 'b'.repeat(64),
    },
    target: { targetKind: 'simulator', deviceId: 'SIM-1' },
    selection: { status: 'selected', backend: 'appium', reasonCode: 'capabilities_matched' },
    readiness: { status: 'ready', reasonCode: 'session_ready' },
    artifacts: {
      collect: ['screenshot'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
  });
}

describe('T6.8 canonical run bundle contracts', () => {
  test('rejects unknown canonical versions and unknown nested RunStep fields', () => {
    expect(RunResultSchema.safeParse({ ...result(), schemaVersion: '4.0' }).success).toBe(false);
    expect(ArtifactIndexSchema.safeParse({ ...index(), schemaVersion: '3.0' }).success).toBe(false);
    expect(() =>
      RunStepsDocumentSchema.parse({
        ...steps(),
        steps: [{ ...steps().steps[0], unexpected: true }],
      }),
    ).toThrow();
  });

  test('accepts a TestPlan bundle with a matching ProjectProfile reference and empty xcresult case steps', () => {
    const base = makeValidTestPlan();
    const plan = makeValidTestPlan({
      runId,
      device: { kind: 'simulator', simulator: { selector: 'by_udid', udid: 'SIM-1' } },
      performance: { ...base.performance, baselineDomain: 'simulator' },
      execution: {
        ...base.execution,
        prefer: 'xcuitest',
        fallback: 'abort',
        resolvedPath: 'xcuitest',
        selectionReason: 'explicit_preference',
        xcuitest: { scheme: 'ExampleUITests' },
      },
    });
    expect(
      validateRunBundleDocuments({
        plan,
        steps: steps(),
        result: result(plan.projectProfileRef),
        artifactIndex: index(),
      }),
    ).toEqual([]);
  });

  test('accepts standalone FlowReplayPlan only without a fabricated ProjectProfile reference', () => {
    expect(
      validateRunBundleDocuments({
        plan: flowPlan(),
        steps: steps(),
        result: result(undefined, 'device_backend'),
        artifactIndex: index(),
      }),
    ).toEqual([]);
    const issues = validateRunBundleDocuments({
      plan: flowPlan(),
      steps: steps(),
      result: result('/fake/profile.json', 'device_backend'),
      artifactIndex: index(),
    });
    expect(issues.some((issue) => issue.path === 'result.projectProfileRef')).toBe(true);
  });

  test('rejects non-contiguous step sequence and invalid evidence outcome references', () => {
    expect(() =>
      RunStepsDocumentSchema.parse({ ...steps(), steps: [{ ...steps().steps[0], sequence: 2 }] }),
    ).toThrow();
    const badIndex = {
      ...index(),
      collectionOutcomes: [
        { type: 'trace', status: 'collected', reasonCode: 'collected', artifactId: 'missing' },
      ],
    };
    expect(() =>
      parseValidatedRunBundle({
        plan: flowPlan(),
        steps: steps(),
        result: result(undefined, 'device_backend'),
        artifactIndex: badIndex,
      }),
    ).toThrow();
  });

  test('requires reason without artifactId for unsuccessful evidence collection', () => {
    expect(() =>
      ArtifactIndexSchema.parse({
        schemaVersion: '2.0',
        runId,
        artifacts: [],
        collectionOutcomes: [
          { type: 'trace', status: 'failed', reasonCode: 'collector_failed', artifactId: 'fake' },
        ],
      }),
    ).toThrow();
  });

  test('binds Flow backend selection to the reported backend', () => {
    const mismatched = structuredClone(result(undefined, 'device_backend'));
    mismatched.execution.backendUsed = 'mobile-mcp';
    const issues = validateRunBundleDocuments({
      plan: flowPlan(),
      steps: steps(),
      result: mismatched,
      artifactIndex: index(),
    });
    expect(issues.some((issue) => issue.path === 'result.execution.backendUsed')).toBe(true);
  });

  test('requires reciprocal step and artifact ownership references', () => {
    const missingStepReference = structuredClone(steps());
    const firstStep = missingStepReference.steps[0];
    if (!firstStep) throw new Error('fixture must contain one step');
    firstStep.artifacts = [];
    const forwardIssues = validateRunBundleDocuments({
      plan: flowPlan(),
      steps: missingStepReference,
      result: result(undefined, 'device_backend'),
      artifactIndex: index(),
    });
    expect(forwardIssues.some((issue) => issue.path === 'artifacts[xcresult-1].relatedStep')).toBe(
      true,
    );

    const missingArtifactReference = structuredClone(index());
    const firstArtifact = missingArtifactReference.artifacts[0];
    if (!firstArtifact) throw new Error('fixture must contain one artifact');
    firstArtifact.relatedStep = undefined;
    const reverseIssues = validateRunBundleDocuments({
      plan: flowPlan(),
      steps: steps(),
      result: result(undefined, 'device_backend'),
      artifactIndex: missingArtifactReference,
    });
    expect(reverseIssues.some((issue) => issue.path === 'steps[step-1].artifacts')).toBe(true);
  });

  test('rejects mismatched evidence types and orphaned artifacts', () => {
    const mismatchedOutcome = structuredClone(index());
    const firstOutcome = mismatchedOutcome.collectionOutcomes[0];
    if (!firstOutcome) throw new Error('fixture must contain one outcome');
    firstOutcome.type = 'trace';
    expect(
      validateRunBundleDocuments({
        plan: flowPlan(),
        steps: steps(),
        result: result(undefined, 'device_backend'),
        artifactIndex: mismatchedOutcome,
      }).some((issue) => issue.path === 'collectionOutcomes.type'),
    ).toBe(true);

    const orphaned = structuredClone(index());
    orphaned.artifacts.push({
      id: 'orphan-log',
      type: 'log',
      path: 'artifacts/orphan.log',
      sizeBytes: 1,
      sha256: 'c'.repeat(64),
      redactionStatus: 'safe',
    });
    expect(
      validateRunBundleDocuments({
        plan: flowPlan(),
        steps: steps(),
        result: result(undefined, 'device_backend'),
        artifactIndex: orphaned,
      }).some((issue) => issue.path === 'artifacts[orphan-log]'),
    ).toBe(true);
  });
});
