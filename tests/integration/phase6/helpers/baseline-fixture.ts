import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestPlanSchema } from 'itestagent-contracts';
import { createBaselineStore, createRunStore, createStoreCore, initStore } from 'itestagent-store';
import { persistConfirmedRun } from '../../../../packages/itestagent-engine/src/confirmed-run-bundle.js';

/** Real canonical persistence with deterministic transport evidence; no device or user store. */
export async function baselineFixture() {
  const root = await mkdtemp(join(tmpdir(), 'itestagent-baseline-acceptance-'));
  initStore(root);
  const core = createStoreCore(':memory:');
  await core.driver.migrate();
  const store = createRunStore(core.db, root);
  const baselineStore = createBaselineStore(root);
  const device = {
    udid: 'FIXTURE',
    name: 'Fixture phone',
    model: 'Fixture',
    osVersion: '26.0',
    platform: 'ios' as const,
    targetKind: 'physical' as const,
  };
  const plan = TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId: 'run-baseline-selected',
    projectProfileRef: `~/.itestagent/projects/${'a'.repeat(64)}/project-profile.json`,
    target: { type: 'current_workspace' },
    device: { kind: 'physical', physical: { selector: 'by_udid', udid: 'FIXTURE' } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {},
    execution: {
      prefer: 'device_backend',
      fallback: 'abort',
      resolvedPath: 'device_backend',
      selectionReason: 'explicit_preference',
      features: ['validation'],
      goal: 'Confirm Ready.',
      metrics: ['memory_peak', 'memory_growth'],
      assertions: [
        {
          id: 'ready',
          caseId: 'validation',
          source: 'user',
          conditions: [{ type: 'element_visible', target: 'Ready', description: 'Ready visible' }],
        },
      ],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
    },
    artifacts: {
      collect: [],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: {
      baseline: 'local_auto',
      baselineDomain: 'physical',
      thresholdRequired: false,
      memoryObservation: { minimumDurationMs: 1000, settleDurationMs: 0 },
    },
    safety: { defaultMode: 'ask', highRiskActions: ['update_baseline'] },
  });
  await persistConfirmedRun({
    store,
    baselineStore,
    plan,
    device,
    resultBundlePath: join(root, 'unused.xcresult'),
    dispatch: {
      status: 'completed',
      path: 'device_backend',
      fallbackHistory: [],
      result: {
        runDir: root,
        steps: [],
        assertion: {
          status: 'passed',
          cases: [{ caseId: 'validation', status: 'passed', resolvedBy: 'user' }],
          summary: 'Fixture success',
        },
        artifacts: [],
        artifactIndexPath: null,
        artifactCount: 0,
      },
    },
    performance: {
      artifacts: [],
      metrics: {
        memoryPeakMB: 30,
        memoryPeakUnit: 'MiB',
        approximate: true,
        memoryGrowth: {
          source: 'activity-monitor-process-live',
          approximate: true,
          scope: 'observed_interval',
          coverage: 'complete',
          recordingDurationMs: 1000,
          samples: [
            { timestampMs: 0, footprintMiB: 20 },
            { timestampMs: 1000, footprintMiB: 30 },
          ],
          sampleCount: 2,
          startMiB: 20,
          endMiB: 30,
          peakMiB: 30,
          deltaMiB: 10,
          durationMs: 1000,
          rateMiBPerMinute: 600,
          direction: 'increased',
        },
      },
    },
  });
  const original = (await baselineStore.list())[0];
  if (!original) throw new Error('Fixture baseline missing');
  const old = {
    ...original,
    memoryPeakMB: 50,
    memoryGrowthMiB: 25,
    updatedFromRun: 'run-baseline-old',
    reachableRuns: ['run-baseline-old'],
  };
  await baselineStore.save(old);
  return {
    root,
    store,
    baselineStore,
    plan,
    old,
    dependencies: {
      loadRunBundle: (id: string) => store.loadRunBundle(id),
      baselineStore,
      projectProfileRef: async () => plan.projectProfileRef,
    },
    async cleanup() {
      core.sqlite.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
