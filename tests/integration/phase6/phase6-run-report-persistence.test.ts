import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { FlowReplayPlanSchema, type RunStep } from 'itestagent-contracts';
import { persistRunBundle } from 'itestagent-engine';
import { RunWriter, createRunStore, createStoreCore, initStore, schema } from 'itestagent-store';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'itestagent-phase6-run-bundle-'));
  roots.push(root);
  initStore(root);
  const core = createStoreCore(join(root, 'db', 'itestagent.db'));
  await core.driver.migrate();
  return { root, core, store: createRunStore(core.db, root) };
}

describe('T6.8 production run report persistence', () => {
  test('commits a self-contained bundle and reconciles SQLite after a post-marker crash', async () => {
    const { root, core, store } = await setup();
    const runId = 'phase6-flow-replay';
    const sourceBundle = join(root, 'Source.xcresult');
    await mkdir(sourceBundle);
    await writeFile(join(sourceBundle, 'Info.plist'), 'bundle evidence');
    const plan = FlowReplayPlanSchema.parse({
      schemaVersion: 'itestagent.flow-replay-plan.v1',
      runId,
      flow: {
        flowId: 'smoke',
        source: 'global',
        sourcePath: '/flows/smoke.yaml',
        sha256: 'a'.repeat(64),
      },
      target: { targetKind: 'simulator', deviceId: 'SIM-1' },
      selection: { status: 'selected', backend: 'appium', reasonCode: 'backend.selected' },
      readiness: { status: 'ready', reasonCode: 'session.ready' },
      artifacts: {
        collect: ['xcresult'],
        report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
      },
    });
    const steps: RunStep[] = [
      {
        stepId: 'step-1',
        sequence: 1,
        backend: 'appium',
        targetKind: 'simulator',
        action: 'collect_result',
        input: {},
        result: { collected: true },
        status: 'completed',
        artifacts: ['xcresult-1'],
        startedAt: '2026-09-03T00:00:00.000Z',
        durationMs: 10,
      },
    ];

    const committed = await persistRunBundle({
      store,
      plan,
      report: {
        runId,
        status: 'explored',
        device: {
          udid: 'SIM-1',
          name: 'Simulator',
          model: 'iPhone17,1',
          osVersion: '18.2',
          targetKind: 'simulator',
        },
        execution: {
          mode: 'device_backend',
          totalSteps: 1,
          completedSteps: 1,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 10,
          startTime: '2026-09-03T00:00:00.000Z',
          endTime: '2026-09-03T00:00:00.010Z',
          targetKind: 'simulator',
          backendUsed: 'appium',
          deviceId: 'SIM-1',
        },
        cases: [],
        metrics: {},
        environment: {
          targetKind: 'simulator',
          representativeOfPhysicalDevice: false,
          comparisonScope: 'simulator_only',
        },
        artifactRefs: ['xcresult-1'],
        allArtifacts: [
          {
            id: 'xcresult-1',
            type: 'xcresult',
            path: sourceBundle,
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
        steps,
      },
    });

    expect(await Bun.file(join(committed.runDir, 'result.json')).exists()).toBe(true);
    expect(await Bun.file(join(committed.runDir, 'steps.json')).exists()).toBe(true);
    const index = JSON.parse(await readFile(join(committed.runDir, 'artifact-index.json'), 'utf8'));
    expect(index.artifacts[0].path).toEndWith('.xcresult');
    expect(index.artifacts[0].sizeBytes).toBeGreaterThan(0);
    expect(index.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);

    await core.db.delete(schema.runSteps).where(eq(schema.runSteps.runId, runId));
    await core.db.delete(schema.runArtifacts).where(eq(schema.runArtifacts.runId, runId));
    await core.db
      .update(schema.runs)
      .set({ status: 'incomplete' })
      .where(eq(schema.runs.runId, runId));
    const recovery = await store.reconcile();
    expect(recovery.recovered).toContain(runId);
    expect((await store.findById(runId))?.status).toBe('explored');
    expect(
      await core.db.select().from(schema.runSteps).where(eq(schema.runSteps.runId, runId)),
    ).toHaveLength(1);
    expect(
      await core.db.select().from(schema.runArtifacts).where(eq(schema.runArtifacts.runId, runId)),
    ).toHaveLength(1);
  });

  test('does not publish result.json when a normal artifact is empty', async () => {
    const { root } = await setup();
    const source = join(root, 'empty.log');
    await writeFile(source, '');
    const writer = await RunWriter.begin('empty-artifact', join(root, 'runs'));
    await expect(
      writer.importArtifact({
        id: 'empty',
        type: 'log',
        sourcePath: source,
        redactionStatus: 'raw-local-only',
      }),
    ).rejects.toThrow('non-empty');
    expect(await Bun.file(join(writer.runDir, 'result.json')).exists()).toBe(false);
    writer.abort();
  });

  test('commits controlled failed, cancelled, and infrastructure-failed outcomes', async () => {
    const { store } = await setup();
    for (const status of ['failed', 'cancelled', 'infra_failed'] as const) {
      const runId = `controlled-${status}`;
      const plan = FlowReplayPlanSchema.parse({
        schemaVersion: 'itestagent.flow-replay-plan.v1',
        runId,
        flow: {
          flowId: 'controlled',
          source: 'global',
          sourcePath: '/flows/controlled.yaml',
          sha256: 'b'.repeat(64),
        },
        target: { targetKind: 'simulator', deviceId: 'SIM-1' },
        selection: { status: 'selected', backend: 'appium', reasonCode: 'backend.selected' },
        readiness: { status: 'ready', reasonCode: 'session.ready' },
        artifacts: {
          collect: [],
          report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
        },
      });
      const committed = await persistRunBundle({
        store,
        plan,
        report: {
          runId,
          status,
          device: {
            udid: 'SIM-1',
            name: 'Simulator',
            model: 'iPhone17,1',
            osVersion: '18.2',
            targetKind: 'simulator',
          },
          execution: {
            mode: 'device_backend',
            totalSteps: 0,
            completedSteps: 0,
            failedSteps: 0,
            skippedSteps: 0,
            durationMs: 0,
            startTime: '2026-09-03T00:00:00.000Z',
            endTime: '2026-09-03T00:00:00.000Z',
            targetKind: 'simulator',
            backendUsed: 'appium',
            deviceId: 'SIM-1',
          },
          cases: [],
          metrics: {},
          environment: {
            targetKind: 'simulator',
            representativeOfPhysicalDevice: false,
            comparisonScope: 'simulator_only',
          },
          artifactRefs: [],
          allArtifacts: [],
          collectionOutcomes: [],
          steps: [],
          explanation: {
            explanationType: status === 'failed' ? 'product_regression' : 'env_issue',
            summary: `Controlled ${status}`,
            evidence: [],
          },
        },
      });
      const result = JSON.parse(await readFile(join(committed.runDir, 'result.json'), 'utf8'));
      expect(result.status).toBe(status);
    }
  });
});
