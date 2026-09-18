import { afterEach, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PermissionEngine, createMemoryBaselineAcceptance } from 'itestagent-engine';
import { createAgentSession } from '../../../packages/itestagent-tui/src/agent-session.js';
import { baselineFixture } from './helpers/baseline-fixture.js';

const fixtures: Awaited<ReturnType<typeof baselineFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.cleanup();
});
async function fixture() {
  const f = await baselineFixture();
  fixtures.push(f);
  return f;
}

test.each(['allow', 'deny', 'timeout', 'cancel', 'changed', 'tampered'] as const)(
  'baseline acceptance %s preserves confirmation and canonical boundaries',
  async (outcome) => {
    const f = await fixture();
    const engine = new PermissionEngine({ askTimeoutMs: 30 });
    const abort = new AbortController();
    const previews: string[] = [];
    let asks = 0;
    const report = join(f.root, 'runs', f.plan.runId, 'result.json');
    const before = await readFile(report, 'utf8');
    let mutation: Promise<unknown> = Promise.resolve();
    const task = createMemoryBaselineAcceptance(f.dependencies)({
      runId: f.plan.runId,
      permissionEngine: engine,
      signal: abort.signal,
      preview: (text) => previews.push(text),
      resolved: () => {},
      requested: ({ callId, action }) => {
        asks++;
        expect(action).toBe('update_baseline');
        expect(previews[0]).toContain('50.000000 MiB');
        expect(previews[0]).toContain('30.000000 MiB');
        expect(previews[0]).not.toContain('FIXTURE');
        if (outcome === 'cancel') abort.abort();
        else if (outcome === 'changed' || outcome === 'tampered') {
          mutation = (
            outcome === 'changed'
              ? f.baselineStore.save({ ...f.old, memoryPeakMB: 99 })
              : writeFile(report, '{}')
          ).then(() => engine.resolve(callId, 'allow', false));
        } else if (outcome !== 'timeout') engine.resolve(callId, outcome, false);
      },
    });
    if (outcome === 'allow') await task;
    else await expect(task).rejects.toThrow();
    await mutation;
    expect(asks).toBe(1);
    const stored = await f.baselineStore.get(f.old.key);
    expect(stored?.memoryPeakMB).toBe(outcome === 'allow' ? 30 : outcome === 'changed' ? 99 : 50);
    expect(stored?.memoryGrowthMiB).toBe(outcome === 'allow' ? 10 : 25);
    expect(stored?.updatedFromRun).toBe(outcome === 'allow' ? f.plan.runId : 'run-baseline-old');
    if (outcome !== 'tampered') expect(await readFile(report, 'utf8')).toBe(before);
  },
);

test.each([
  'project',
  'failed',
  'crash',
  'partial',
  'missing_metric',
  'device',
  'scenario',
  'simulator',
] as const)('rejects %s before asking permission', async (problem) => {
  const f = await fixture();
  const bundle = await f.store.loadRunBundle(f.plan.runId);
  if (problem === 'failed') bundle.result.status = 'failed';
  if (problem === 'crash') bundle.result.metrics.crashDetected = true;
  if (problem === 'partial' && bundle.result.metrics.memoryGrowth)
    bundle.result.metrics.memoryGrowth.coverage = 'partial';
  if (problem === 'missing_metric') bundle.result.metrics.collection = [];
  if (problem === 'device') bundle.result.device.udid = 'DIFFERENT';
  if (problem === 'scenario' && bundle.plan.schemaVersion === 'itestagent.test-plan.v3')
    bundle.plan.execution.goal = 'Different workload';
  if (problem === 'simulator') bundle.result.device.targetKind = 'simulator';
  let asks = 0;
  await expect(
    createMemoryBaselineAcceptance({
      ...f.dependencies,
      loadRunBundle: async () => bundle,
      projectProfileRef: async () =>
        problem === 'project' ? 'different' : f.plan.projectProfileRef,
    })({
      runId: f.plan.runId,
      permissionEngine: new PermissionEngine(),
      signal: new AbortController().signal,
      preview: () => {},
      requested: () => {
        asks++;
      },
      resolved: () => {},
    }),
  ).rejects.toThrow();
  expect(asks).toBe(0);
  expect(await f.baselineStore.get(f.old.key)).toEqual(f.old);
});

test('TUI command reaches the real service without planning/model calls and asks again on every attempt', async () => {
  const f = await fixture();
  let analyzeCalls = 0;
  let asks = 0;
  const session = await createAgentSession(f.root, {
    baselineAcceptance: f.dependencies,
    loadApiKey: async () => 'fixture',
    createModel: () => ({}) as never,
    listDevices: async () => [],
    analyzeWorkspace: async () => {
      analyzeCalls++;
      throw new Error('Unexpected planning');
    },
  });
  try {
    for (const effect of ['allow', 'deny'] as const) {
      const messages: string[] = [];
      for await (const patch of session.processMessage(`/baseline accept ${f.plan.runId}`)) {
        if (patch.type === 'permission_request') {
          asks++;
          await session.resolvePermission(String(patch.payload.callId), effect);
        }
        if (patch.payload.text) messages.push(String(patch.payload.text));
        if (patch.type === 'error') messages.push(String(patch.payload.message));
      }
      expect(messages.join('\n')).toContain(
        effect === 'allow' ? 'Memory baseline updated' : 'baseline_denied',
      );
    }
    expect(asks).toBe(2);
    expect(analyzeCalls).toBe(0);
  } finally {
    session.dispose();
  }
});

test('persistent deny does not display a fresh ask or mutate the baseline', async () => {
  const f = await fixture();
  let asks = 0;
  const engine = new PermissionEngine({
    preloadedRules: [{ action: 'update_baseline', resource: '*', effect: 'deny' }],
  });
  await expect(
    createMemoryBaselineAcceptance(f.dependencies)({
      runId: f.plan.runId,
      permissionEngine: engine,
      signal: new AbortController().signal,
      preview: () => {},
      requested: () => {
        asks++;
      },
      resolved: (_id, effect, reason) => {
        expect(effect).toBe('deny');
        expect(reason).toBeUndefined();
      },
    }),
  ).rejects.toThrow('baseline_denied');
  expect(asks).toBe(0);
  expect(await f.baselineStore.get(f.old.key)).toEqual(f.old);
});

test('TUI dispose while permission is pending cancels the request without a write', async () => {
  const f = await fixture();
  const session = await createAgentSession(f.root, {
    baselineAcceptance: f.dependencies,
    loadApiKey: async () => 'fixture',
    createModel: () => ({}) as never,
    listDevices: async () => [],
  });
  const errors: string[] = [];
  for await (const patch of session.processMessage(`/baseline accept ${f.plan.runId}`)) {
    if (patch.type === 'permission_request') session.dispose();
    if (patch.type === 'error') errors.push(String(patch.payload.message));
  }
  expect(errors.join()).toContain('session closed');
  expect(await f.baselineStore.get(f.old.key)).toEqual(f.old);
});
