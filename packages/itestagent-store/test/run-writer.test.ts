import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ArtifactIndexSchema,
  FlowReplayPlanSchema,
  RunResultSchema,
  type RunStep,
} from 'itestagent-contracts';
import { RunWriter, measureRunArtifactPath } from '../src/run-writer.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'itestagent-run-writer-'));
  roots.push(root);
  const runsRoot = join(root, 'runs');
  const source = join(root, 'shot.png');
  await writeFile(source, 'evidence');
  const runId = 'run-writer-1';
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
    selection: { status: 'selected', backend: 'appium', reasonCode: 'capabilities_matched' },
    readiness: { status: 'ready', reasonCode: 'session_ready' },
    artifacts: {
      collect: ['screenshot'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
  });
  return { root, runsRoot, source, runId, plan };
}

describe('RunWriter', () => {
  test('uses the canonical 128-character run ID boundary', async () => {
    const { runsRoot } = await fixture();
    await expect(RunWriter.begin('a'.repeat(129), runsRoot)).rejects.toThrow('unsafe runId');
  });

  test('owns plan, checkpoints, artifacts and commits result.json last', async () => {
    const { runsRoot, source, runId, plan } = await fixture();
    const writer = await RunWriter.begin(runId, runsRoot);
    await writer.writePlan(plan);
    const artifact = await writer.importArtifact({
      id: 'shot-1',
      type: 'screenshot',
      sourcePath: source,
      redactionStatus: 'raw-local-only',
      relatedStep: 'step-1',
    });
    const steps: RunStep[] = [
      {
        stepId: 'step-1',
        sequence: 1,
        backend: 'appium',
        targetKind: 'simulator',
        action: 'screenshot',
        input: {},
        result: {},
        status: 'completed',
        artifacts: ['shot-1'],
        startedAt: '2026-09-03T00:00:00.000Z',
        durationMs: 1,
      },
    ];
    await writer.checkpoint(steps);
    const artifactIndex = ArtifactIndexSchema.parse({
      schemaVersion: '2.0',
      runId,
      artifacts: [artifact],
      collectionOutcomes: [
        {
          type: 'screenshot',
          status: 'collected',
          reasonCode: 'collected',
          artifactId: 'shot-1',
          relatedStep: 'step-1',
        },
      ],
    });
    const result = RunResultSchema.parse({
      schemaVersion: '3.0',
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
        durationMs: 1,
        startTime: '2026-09-03T00:00:00.000Z',
        endTime: '2026-09-03T00:00:00.001Z',
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
      artifactRefs: ['shot-1'],
    });
    await writer.commit({ result, artifactIndex, summary: '# Complete\n' });

    expect(
      JSON.parse(await readFile(join(writer.runDir, 'result.json'), 'utf8')).schemaVersion,
    ).toBe('3.0');
    expect((await stat(writer.runDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(writer.runDir, artifact.path))).mode & 0o777).toBe(0o600);
    for (const file of [
      'plan.yaml',
      'steps.json',
      'artifact-index.json',
      'summary.md',
      'result.json',
    ]) {
      expect((await stat(join(writer.runDir, file))).mode & 0o777).toBe(0o600);
    }
    await expect(RunWriter.begin(runId, runsRoot)).rejects.toThrow('already committed');
    expect(await Bun.file(join(writer.runDir, '.writer.lock')).exists()).toBe(false);
  });

  test('rejects a second active writer and does not publish result on validation failure', async () => {
    const { runsRoot, runId, plan } = await fixture();
    const writer = await RunWriter.begin(runId, runsRoot);
    await expect(RunWriter.begin(runId, runsRoot)).rejects.toThrow('active writer');
    await writer.writePlan(plan);
    await writer.checkpoint([]);
    const result = RunResultSchema.parse({
      schemaVersion: '3.0',
      runId,
      status: 'infra_failed',
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
      artifactRefs: ['missing'],
    });
    const index = ArtifactIndexSchema.parse({
      schemaVersion: '2.0',
      runId,
      artifacts: [],
      collectionOutcomes: [{ type: 'screenshot', status: 'failed', reasonCode: 'session_failed' }],
    });
    await expect(
      writer.commit({ result, artifactIndex: index, summary: '# Incomplete\n' }),
    ).rejects.toThrow();
    expect(await Bun.file(join(writer.runDir, 'result.json')).exists()).toBe(false);
    writer.abort();
  });

  test('rejects a writer in another process and recovers its stale lock after exit', async () => {
    const { runsRoot } = await fixture();
    const runId = 'cross-process-writer';
    const writerModule = pathToFileURL(join(import.meta.dir, '../src/run-writer.ts')).href;
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `const { RunWriter } = await import(process.env.ITEST_WRITER_MODULE);
         const writer = await RunWriter.begin('cross-process-writer', process.env.ITEST_RUNS_ROOT);
         console.log('READY');
         await Bun.sleep(60_000);
         writer.abort();`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ITEST_RUNS_ROOT: runsRoot,
          ITEST_WRITER_MODULE: writerModule,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    try {
      const reader = child.stdout.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('READY');
      reader.releaseLock();
      await expect(RunWriter.begin(runId, runsRoot)).rejects.toThrow('active writer');
    } finally {
      child.kill();
      await child.exited;
    }
    expect(RunWriter.recoverStaleLock(runId, runsRoot)).toBe(true);
    const recovered = await RunWriter.begin(runId, runsRoot);
    recovered.abort();
  });

  test('rejects a symlinked artifact destination chain', async () => {
    const { root, runsRoot, source, runId } = await fixture();
    const writer = await RunWriter.begin(runId, runsRoot);
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(writer.artifactsDir, 'escape'));
    await expect(
      writer.importArtifact({
        id: 'escape',
        type: 'screenshot',
        sourcePath: source,
        relativePath: 'artifacts/escape/evidence.png',
        redactionStatus: 'raw-local-only',
      }),
    ).rejects.toThrow('real directories');
    expect(await Bun.file(join(outside, 'evidence.png')).exists()).toBe(false);
    writer.abort();
  });

  test('rejects source traversal and a symlinked source parent', async () => {
    const { root, runsRoot, source, runId } = await fixture();
    const staging = join(root, 'staging');
    const linkedDirectory = join(staging, 'linked');
    await mkdir(staging);
    await symlink(root, linkedDirectory);
    const writer = await RunWriter.begin(runId, runsRoot);
    await expect(
      writer.importArtifact({
        id: 'outside',
        type: 'screenshot',
        sourcePath: source,
        sourceRoot: staging,
        redactionStatus: 'raw-local-only',
      }),
    ).rejects.toThrow('declared root');
    await expect(
      writer.importArtifact({
        id: 'linked',
        type: 'screenshot',
        sourcePath: join(linkedDirectory, 'shot.png'),
        sourceRoot: staging,
        redactionStatus: 'raw-local-only',
      }),
    ).rejects.toThrow(/declared root|symlink/);
    writer.abort();
  });

  test('accepts a non-empty trace bundle and rejects empty or mistyped bundles', async () => {
    const { root, runsRoot, runId } = await fixture();
    const trace = join(root, 'Performance.trace');
    await mkdir(trace);
    await writeFile(join(trace, 'data.bin'), 'trace data');
    const emptyBundle = join(root, 'Empty.xcresult');
    await mkdir(emptyBundle);
    const writer = await RunWriter.begin(runId, runsRoot);
    const imported = await writer.importArtifact({
      id: 'trace-1',
      type: 'trace',
      sourcePath: trace,
      redactionStatus: 'raw-local-only',
    });
    expect(imported.sizeBytes).toBeGreaterThan(0);
    expect(imported.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      writer.importArtifact({
        id: 'empty-bundle',
        type: 'xcresult',
        sourcePath: emptyBundle,
        redactionStatus: 'raw-local-only',
      }),
    ).rejects.toThrow('non-empty');
    await expect(
      writer.importArtifact({
        id: 'mistyped',
        type: 'log',
        sourcePath: trace,
        redactionStatus: 'raw-local-only',
      }),
    ).rejects.toThrow('only xcresult and trace');
    writer.abort();
  });

  test('hashes directory artifacts deterministically regardless of creation order', async () => {
    const { root } = await fixture();
    const first = join(root, 'First.trace');
    const second = join(root, 'Second.trace');
    await mkdir(first);
    await mkdir(second);
    await writeFile(join(first, 'b.bin'), 'second');
    await writeFile(join(first, 'a.bin'), 'first');
    await writeFile(join(second, 'a.bin'), 'first');
    await writeFile(join(second, 'b.bin'), 'second');

    const firstMeasurement = await measureRunArtifactPath(first, 'trace');
    const secondMeasurement = await measureRunArtifactPath(second, 'trace');
    expect(firstMeasurement).toEqual(secondMeasurement);
  });
});
