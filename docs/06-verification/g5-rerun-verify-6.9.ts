import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestPlanSchema, type TestPlan } from 'itestagent-contracts';
import {
  createProductionAgentSessionDependencies,
  createRerunPlan,
  executeProductionTestPlan,
  persistRunBundle,
} from 'itestagent-engine';
import { createRunStore, createStoreCore, initStore } from 'itestagent-store';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const targetKind = requiredEnv('ITESTAGENT_TARGET_KIND');
if (targetKind !== 'physical' && targetKind !== 'simulator') {
  throw new Error('ITESTAGENT_TARGET_KIND must be physical or simulator');
}
if (process.env.ITESTAGENT_CONFIRM_XCUITEST_SIDE_EFFECTS?.trim() !== 'yes') {
  throw new Error('ITESTAGENT_CONFIRM_XCUITEST_SIDE_EFFECTS=yes is required');
}

const deviceId = requiredEnv('ITESTAGENT_DEVICE_ID');
const deviceName = requiredEnv('ITESTAGENT_DEVICE_NAME');
const platformVersion = requiredEnv('ITESTAGENT_PLATFORM_VERSION');
const workspace = requiredEnv('ITESTAGENT_XCODE_WORKSPACE');
const scheme = requiredEnv('ITESTAGENT_XCODE_SCHEME');
const testTarget = requiredEnv('ITESTAGENT_XCODE_TEST_TARGET');
const testClass = requiredEnv('ITESTAGENT_XCODE_TEST_CLASS');
const selectedMethod = requiredEnv('ITESTAGENT_XCODE_SELECTED_METHOD');
const controlMethod = requiredEnv('ITESTAGENT_XCODE_CONTROL_METHOD');
const bundleId = requiredEnv('ITESTAGENT_APP_BUNDLE_ID');
const selectedCaseId = `${testTarget}/${testClass}/${selectedMethod}`;
const controlCaseId = `${testTarget}/${testClass}/${controlMethod}`;

const root = mkdtempSync(join(tmpdir(), `itestagent-g5-${targetKind}-6-9-xcuitest-`));
initStore(root);
const core = createStoreCore(join(root, 'db', 'itestagent.db'));
await core.driver.migrate();
const store = createRunStore(core.db, root);
const parentRunId = `g5-${targetKind}-6-9-xcuitest-parent`;
const childRunId = `g5-${targetKind}-6-9-xcuitest-child`;

function parentPlan(): TestPlan {
  return TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId: parentRunId,
    projectProfileRef:
      'projects/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/project-profile.json',
    target: { type: 'current_workspace' },
    device:
      targetKind === 'physical'
        ? { kind: 'physical', physical: { selector: 'by_udid', udid: deviceId } }
        : { kind: 'simulator', simulator: { selector: 'by_udid', udid: deviceId } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: 'xcuitest',
      fallback: 'abort',
      resolvedPath: 'xcuitest',
      selectionReason: 'explicit_preference',
      features: [selectedCaseId, controlCaseId],
      testData: { allowAgentGeneratedData: false, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      xcuitest: { scheme, targets: [testTarget] },
    },
    artifacts: {
      collect: ['xcresult'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'skip', baselineDomain: targetKind, thresholdRequired: false },
    safety: {
      defaultMode: 'ask',
      highRiskActions: ['execute_project_build', 'replace_device_app'],
    },
  });
}

const plan = parentPlan();
await persistRunBundle({
  store,
  plan,
  report: {
    runId: parentRunId,
    status: 'failed',
    projectProfileRef: plan.projectProfileRef,
    device: {
      udid: deviceId,
      name: deviceName,
      model: deviceName,
      osVersion: platformVersion,
      targetKind,
    },
    execution: {
      mode: 'xcuitest',
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 1,
      startTime: '2026-09-04T00:00:00.000Z',
      endTime: '2026-09-04T00:00:00.001Z',
      targetKind,
      backendUsed: 'xcodebuild',
      deviceId,
    },
    cases: [
      {
        caseId: selectedCaseId,
        name: selectedMethod,
        status: 'failed',
        steps: [],
        durationMs: 1,
        artifacts: [],
      },
      {
        caseId: controlCaseId,
        name: controlMethod,
        status: 'passed',
        steps: [],
        durationMs: 1,
        artifacts: [],
      },
    ],
    metrics: {},
    environment: {
      targetKind,
      representativeOfPhysicalDevice: targetKind === 'physical',
      comparisonScope: targetKind === 'physical' ? 'physical_only' : 'simulator_only',
    },
    artifactRefs: [],
    allArtifacts: [],
    collectionOutcomes: [],
    steps: [],
  },
});

const parent = await store.loadRunBundle(parentRunId);
const childPlan = createRerunPlan({
  parentPlan: plan,
  parentResult: parent.result,
  mode: 'failed_only',
  runId: childRunId,
});

const authorizedActions: string[] = [];
const executed = await executeProductionTestPlan({
  plan: childPlan,
  parentResult: parent.result,
  workspace,
  device: {
    udid: deviceId,
    platform: 'ios',
    name: deviceName,
    model: deviceName,
    osVersion: platformVersion,
    targetKind,
    state: targetKind === 'simulator' ? 'booted' : 'available',
  },
  bundleId,
  store,
  storeRoot: root,
  production: createProductionAgentSessionDependencies(),
  authorize: async (action) => {
    authorizedActions.push(action);
    return true;
  },
  suggest: async () => {
    throw new Error('XCUITest rerun must not invoke model-driven exploration');
  },
});

const child = await store.loadRunBundle(childRunId);
if (executed.path !== 'xcuitest' || executed.status !== 'completed') {
  throw new Error(`XCUITest rerun failed: ${executed.error ?? executed.status}`);
}
if (child.plan.schemaVersion !== 'itestagent.test-plan.v3') throw new Error('child plan missing');
if (child.plan.rerun?.selectedCaseIds.join(',') !== selectedCaseId) {
  throw new Error('failed-only selected the wrong case set');
}
if (child.result.parentRunId !== parentRunId) throw new Error('result parentRunId mismatch');
if (
  child.result.cases.length !== 1 ||
  child.result.cases.some((testCase) => testCase.caseId !== selectedCaseId)
) {
  throw new Error(
    `child result did not contain exactly the selected case: ${child.result.cases
      .map((testCase) => testCase.caseId)
      .join(',')}`,
  );
}
if (child.result.cases.some((testCase) => testCase.caseId === controlCaseId)) {
  throw new Error('control case was executed despite failed-only selection');
}
if (!child.artifactIndex.artifacts.some((artifact) => artifact.type === 'xcresult')) {
  throw new Error('no xcresult evidence was committed');
}

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      targetKind,
      runDir: store.getRunDir(childRunId),
      selectedCaseIds: child.plan.rerun.selectedCaseIds,
      parsedCaseIds: child.result.cases.map((testCase) => testCase.caseId),
      childStatus: child.result.status,
      parentRunId: child.result.parentRunId,
      authorizedActions,
      artifacts: child.artifactIndex.artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        sizeBytes: artifact.sizeBytes,
        redactionStatus: artifact.redactionStatus,
      })),
    },
    null,
    2,
  ),
);
