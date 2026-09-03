import { mkdirSync, mkdtempSync } from 'node:fs';
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
const deviceId = requiredEnv('ITESTAGENT_DEVICE_ID');
const deviceName = requiredEnv('ITESTAGENT_DEVICE_NAME');
const platformVersion = requiredEnv('ITESTAGENT_PLATFORM_VERSION');
const root = mkdtempSync(join(tmpdir(), `itestagent-g5-${targetKind}-6-9-`));
initStore(root);
const core = createStoreCore(join(root, 'db', 'itestagent.db'));
await core.driver.migrate();
const store = createRunStore(core.db, root);
const parentRunId = `g5-${targetKind}-6-9-parent`;
const childRunId = `g5-${targetKind}-6-9-child`;
const failedCaseId = 'settings-failed-checkpoint';
const passedCaseId = 'settings-passed-control';

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
    appSource: { strategy: 'existing_artifact' },
    backendPreference: { device: ['appium'] },
    execution: {
      prefer: 'device_backend',
      fallback: 'device_backend',
      resolvedPath: 'device_backend',
      selectionReason: 'explicit_preference',
      features: [failedCaseId, passedCaseId],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'explore_only' },
    },
    artifacts: {
      collect: ['screenshot', 'uitree'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'skip', baselineDomain: targetKind, thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: ['prepare_wda'] },
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
      mode: 'device_backend',
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0,
      durationMs: 1,
      startTime: '2026-09-03T00:00:00.000Z',
      endTime: '2026-09-03T00:00:00.001Z',
      targetKind,
      backendUsed: 'appium',
      deviceId,
    },
    cases: [
      {
        caseId: failedCaseId,
        name: failedCaseId,
        status: 'failed',
        steps: [],
        durationMs: 1,
        artifacts: [],
      },
      {
        caseId: passedCaseId,
        name: passedCaseId,
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
const wdaMode = process.env.ITESTAGENT_WDA_MODE?.trim();
if (
  targetKind === 'physical' &&
  wdaMode !== 'external-url' &&
  wdaMode !== 'managed-xcodebuild'
) {
  throw new Error('physical verification requires ITESTAGENT_WDA_MODE');
}
if (
  targetKind === 'physical' &&
  wdaMode === 'managed-xcodebuild' &&
  process.env.ITESTAGENT_CONFIRM_PREPARE_WDA?.trim() !== 'yes'
) {
  throw new Error('ITESTAGENT_CONFIRM_PREPARE_WDA=yes is required for managed WDA');
}
const artifactDirectory = join(root, 'runs', childRunId, 'staging', 'artifacts');
mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
const production = createProductionAgentSessionDependencies({
  appium: {
    artifactDirectory,
    appiumServerUrl: process.env.ITESTAGENT_APPIUM_URL,
    platformVersion,
    wdaStartupMode: wdaMode as 'external-url' | 'managed-xcodebuild' | undefined,
    webDriverAgentUrl: process.env.ITESTAGENT_WDA_URL,
    wdaBaseBundleId: process.env.ITESTAGENT_WDA_BUNDLE_ID,
    wdaProjectPath: process.env.ITESTAGENT_WDA_PROJECT_PATH,
    wdaLocalPort: Number(process.env.ITESTAGENT_WDA_LOCAL_PORT ?? 8400),
    mjpegServerPort: Number(process.env.ITESTAGENT_MJPEG_SERVER_PORT ?? 9400),
    xcodeOrgId: process.env.ITESTAGENT_XCODE_ORG_ID,
    xcodeSigningId: process.env.ITESTAGENT_XCODE_SIGNING_ID,
  },
});
const suggestedCases: string[] = [];
const seen = new Set<string>();
await executeProductionTestPlan({
  plan: childPlan,
  parentResult: parent.result,
  workspace: process.cwd(),
  device: {
    udid: deviceId,
    platform: 'ios',
    name: deviceName,
    model: deviceName,
    osVersion: platformVersion,
    targetKind,
    state: 'booted',
  },
  bundleId: 'com.apple.Preferences',
  store,
  storeRoot: root,
  preparesWda: wdaMode === 'managed-xcodebuild',
  production,
  authorize: async (action) =>
    action !== 'prepare_wda' || process.env.ITESTAGENT_CONFIRM_PREPARE_WDA?.trim() === 'yes',
  suggest: async ({ caseId, uiTree }) => {
    if (uiTree.length === 0) throw new Error(`empty UI tree for ${caseId}`);
    suggestedCases.push(caseId);
    if (seen.has(caseId)) return 'done';
    seen.add(caseId);
    return { action: 'screenshot', target: `checkpoint ${caseId}` };
  },
});

const child = await store.loadRunBundle(childRunId);
if (child.plan.schemaVersion !== 'itestagent.test-plan.v3') throw new Error('child plan missing');
if (child.plan.rerun?.selectedCaseIds.join(',') !== failedCaseId) {
  throw new Error('failed-only selected the wrong case set');
}
if (suggestedCases.some((caseId) => caseId !== failedCaseId) || suggestedCases.length !== 2) {
  throw new Error(`DeviceBackend executed an unexpected case set: ${suggestedCases.join(',')}`);
}
if (child.result.parentRunId !== parentRunId) throw new Error('result parentRunId mismatch');
if (child.result.cases.some((testCase) => testCase.caseId !== failedCaseId)) {
  throw new Error('child result contains an unselected case');
}
if (child.artifactIndex.artifacts.length === 0) throw new Error('no real screenshot evidence');
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      targetKind,
      runDir: store.getRunDir(childRunId),
      selectedCaseIds: child.plan.rerun.selectedCaseIds,
      suggestedCases,
      childStatus: child.result.status,
      parentRunId: child.result.parentRunId,
      steps: child.steps.steps.map((step) => ({
        sequence: step.sequence,
        caseId: step.caseId,
        status: step.status,
      })),
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
