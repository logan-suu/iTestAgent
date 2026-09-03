import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ArtifactIndex,
  DeviceInfo,
  EvidenceCollectionOutcome,
  RunStatus,
  RunStep,
  TestCaseResult,
  TestPlan,
} from 'itestagent-contracts';
import {
  ArtifactRefSchema,
  AssertionEvaluateOutputSchema,
  RunStepsDocumentSchema,
} from 'itestagent-contracts';
import type { RunStore } from 'itestagent-store';
import {
  createDefaultRunStore,
  createStoreCore,
  initStore,
  resolveStoreRoot,
} from 'itestagent-store';
import type { ConfirmedExecutionDispatchResult } from './dual-execution-dispatcher.js';
import type { RealDeviceRunResult } from './exploration/real-run.js';
import { persistRunBundle } from './run-bundle-coordinator.js';

export interface PersistConfirmedRunInput {
  store: RunStore;
  plan: TestPlan;
  device: DeviceInfo;
  dispatch: ConfirmedExecutionDispatchResult;
  resultBundlePath: string;
}

export async function persistConfirmedRunToDefaultStore(
  input: Omit<PersistConfirmedRunInput, 'store'>,
): Promise<{ runDir: string }> {
  const storeRoot = initStore(resolveStoreRoot());
  const core = createStoreCore(join(storeRoot, 'db', 'itestagent.db'));
  await core.driver.migrate();
  return persistConfirmedRun({ ...input, store: createDefaultRunStore(core.db) });
}

function isRealDeviceResult(value: unknown): value is RealDeviceRunResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.runDir === 'string' &&
    result.runDir.length > 0 &&
    RunStepsDocumentSchema.safeParse({
      schemaVersion: 'itestagent.run-steps.v1',
      runId: 'device-result-validation',
      steps: result.steps,
    }).success &&
    AssertionEvaluateOutputSchema.safeParse(result.assertion).success &&
    ArtifactRefSchema.array().safeParse(result.artifacts).success &&
    (result.artifactIndexPath === null || typeof result.artifactIndexPath === 'string') &&
    typeof result.artifactCount === 'number' &&
    Number.isInteger(result.artifactCount) &&
    result.artifactCount >= 0
  );
}

/** Convert one confirmed production dispatch into the canonical committed TestPlan bundle. */
export async function persistConfirmedRun(
  input: PersistConfirmedRunInput,
): Promise<{ runDir: string }> {
  const { plan, device, dispatch } = input;
  const now = new Date().toISOString();
  let steps: RunStep[] = [];
  let cases: TestCaseResult[] = [];
  let artifacts: ArtifactIndex['artifacts'] = [];
  let outcomes: EvidenceCollectionOutcome[] = [];
  let status: RunStatus =
    dispatch.status === 'blocked'
      ? 'blocked'
      : dispatch.status === 'cancelled'
        ? 'cancelled'
        : 'infra_failed';
  let startedAt = now;
  let endedAt = now;
  let backendUsed = dispatch.path === 'xcuitest' ? 'xcodebuild' : 'device_backend';
  let metrics = {};
  const invalidDeviceResult =
    dispatch.status !== 'blocked' &&
    dispatch.path === 'device_backend' &&
    dispatch.result !== undefined &&
    !isRealDeviceResult(dispatch.result);

  if (dispatch.status !== 'blocked' && dispatch.path === 'xcuitest' && dispatch.result) {
    const result = dispatch.result;
    steps = (result.executionFacts ?? []).map((fact, index) => ({
      stepId: `${plan.runId}-${fact.action}`,
      sequence: index + 1,
      backend: fact.action === 'xcodebuild_test' ? 'xcodebuild' : 'xcresultparser',
      targetKind: device.targetKind,
      action: fact.action,
      input: {},
      result: fact.result,
      status: fact.status,
      artifacts:
        fact.action === 'xcodebuild_test' && existsSync(input.resultBundlePath)
          ? [`${plan.runId}-xcresult`]
          : [],
      startedAt: fact.startedAt,
      durationMs: fact.durationMs,
    }));
    startedAt = steps[0]?.startedAt ?? now;
    endedAt =
      result.parsed?.execution.endTime ??
      new Date(Date.parse(startedAt) + result.durationMs).toISOString();
    cases = result.parsed?.cases.map((testCase) => ({ ...testCase, steps: [] })) ?? [];
    metrics = result.parsed?.metrics ?? {};
    const assertionFailed = cases.some((testCase) => testCase.status === 'failed');
    status =
      dispatch.status === 'cancelled'
        ? 'cancelled'
        : assertionFailed
          ? 'failed'
          : dispatch.status === 'completed'
            ? 'passed'
            : 'infra_failed';
    if (existsSync(input.resultBundlePath)) {
      artifacts.push({
        id: `${plan.runId}-xcresult`,
        type: 'xcresult',
        path: input.resultBundlePath,
        relatedStep: `${plan.runId}-xcodebuild_test`,
        backend: 'xcodebuild',
        redactionStatus: 'raw-local-only',
      });
      outcomes.push({
        type: 'xcresult',
        status: 'collected',
        reasonCode: 'xcodebuild.result_bundle_collected',
        artifactId: `${plan.runId}-xcresult`,
        relatedStep: `${plan.runId}-xcodebuild_test`,
      });
    } else {
      outcomes.push({
        type: 'xcresult',
        status: 'failed',
        reasonCode: 'xcodebuild.result_bundle_missing',
      });
    }
    for (const attachment of result.parsed?.attachments ?? []) {
      if (existsSync(attachment.path)) {
        artifacts.push({ ...attachment, redactionStatus: 'raw-local-only' });
        outcomes.push({
          type: attachment.type,
          status: 'collected',
          reasonCode: 'xcresult.attachment_extracted',
          artifactId: attachment.id,
          relatedCase: attachment.relatedCase,
        });
      } else {
        outcomes.push({
          type: attachment.type,
          status: 'failed',
          reasonCode: 'xcresult.attachment_staging_missing',
          message: 'The parser attachment path was unavailable when the run bundle was committed.',
          relatedCase: attachment.relatedCase,
        });
      }
    }
  } else if (
    dispatch.status !== 'blocked' &&
    dispatch.path === 'device_backend' &&
    isRealDeviceResult(dispatch.result)
  ) {
    const result = dispatch.result;
    steps = [...result.steps];
    artifacts = [...result.artifacts];
    startedAt = steps[0]?.startedAt ?? now;
    endedAt = new Date().toISOString();
    status = result.assertion.status;
    const caseIds = [
      ...new Set([
        ...plan.execution.features,
        ...result.assertion.cases.map((testCase) => testCase.caseId),
        ...steps.flatMap((step) => (step.caseId ? [step.caseId] : [])),
      ]),
    ];
    cases = caseIds.map((caseId) => {
      const caseSteps = steps.filter((step) => step.caseId === caseId);
      const assertion = result.assertion.cases.find((testCase) => testCase.caseId === caseId);
      const caseArtifacts = artifacts
        .filter((artifact) => artifact.relatedCase === caseId)
        .map((artifact) => artifact.id);
      return {
        caseId,
        name: caseId,
        status:
          assertion?.status ??
          (caseSteps.some((step) => step.status === 'failed') ? 'failed' : 'explored'),
        steps: caseSteps.map((step) => step.stepId),
        durationMs: caseSteps.reduce((sum, step) => sum + step.durationMs, 0),
        artifacts: [...new Set([...caseSteps.flatMap((step) => step.artifacts), ...caseArtifacts])],
      };
    });
    outcomes = artifacts.map((artifact) => ({
      type: artifact.type,
      status: 'collected',
      reasonCode: 'device_backend.collected',
      artifactId: artifact.id,
      relatedStep: artifact.relatedStep,
      relatedCase: artifact.relatedCase,
    }));
    backendUsed = artifacts[0]?.backend ?? 'appium';
  }

  const decidedTypes = new Set(outcomes.map((outcome) => outcome.type));
  for (const type of plan.artifacts.collect) {
    if (!decidedTypes.has(type)) {
      outcomes.push({
        type,
        status:
          dispatch.status === 'blocked' || dispatch.status === 'cancelled'
            ? 'not_applicable'
            : 'unsupported',
        reasonCode:
          dispatch.status === 'blocked'
            ? 'execution.not_started'
            : dispatch.status === 'cancelled'
              ? 'execution.cancelled'
              : 'route.did_not_collect',
      });
    }
  }

  return persistRunBundle({
    store: input.store,
    plan,
    artifactSourceRoot:
      dispatch.status !== 'blocked' &&
      dispatch.path === 'device_backend' &&
      isRealDeviceResult(dispatch.result)
        ? dispatch.result.runDir
        : dirname(input.resultBundlePath),
    report: {
      runId: plan.runId,
      status,
      projectProfileRef: plan.projectProfileRef,
      device: {
        udid: device.udid,
        name: device.name ?? device.udid,
        model: device.model ?? 'unavailable',
        osVersion: device.osVersion ?? 'unavailable',
        targetKind: device.targetKind,
        runtimeIdentifier: device.runtimeIdentifier,
      },
      execution: {
        mode: dispatch.path,
        totalSteps: steps.length,
        completedSteps: steps.filter((step) => step.status === 'completed').length,
        failedSteps: steps.filter((step) => step.status === 'failed').length,
        skippedSteps: 0,
        durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
        startTime: startedAt,
        endTime: endedAt,
        targetKind: device.targetKind,
        backendUsed,
        deviceId: device.udid,
      },
      cases,
      metrics,
      environment: {
        targetKind: device.targetKind,
        representativeOfPhysicalDevice: device.targetKind === 'physical',
        comparisonScope: device.targetKind === 'physical' ? 'physical_only' : 'simulator_only',
      },
      artifactRefs: artifacts.map((artifact) => artifact.id),
      allArtifacts: artifacts,
      collectionOutcomes: outcomes,
      steps,
      ...(status === 'blocked' || status === 'cancelled' || status === 'infra_failed'
        ? {
            explanation: {
              explanationType: 'env_issue' as const,
              summary:
                dispatch.error ??
                (invalidDeviceResult
                  ? 'device_backend.invalid_result: backend returned an invalid result payload.'
                  : 'Execution did not produce an assertion result.'),
              evidence: [],
              confidence: 'high' as const,
            },
          }
        : {}),
    },
  });
}
