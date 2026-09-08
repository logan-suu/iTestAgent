import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BackendCleanupOutcome,
  DeviceBackend,
  DeviceInfo,
  PhysicalPreflightResult,
} from 'itestagent-contracts';
import { TestPlanSchema } from 'itestagent-contracts';
import { executeProductionTestPlan, suggestExplorationAction } from 'itestagent-engine';
import { createRunStore, createStoreCore, initStore } from 'itestagent-store';

const roots: string[] = [];
const databases: Array<ReturnType<typeof createStoreCore>['sqlite']> = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const device: DeviceInfo = {
  udid: 'FIXTURE-PHYSICAL-RECOVERY',
  name: 'Fixture iPhone',
  model: 'iPhone',
  osVersion: '18.0',
  platform: 'ios',
  targetKind: 'physical',
};
const modelOnlyMarker = 'RAW_MODEL_RESPONSE_MUST_NOT_ESCAPE';
const screenshotOnlyMarker = 'RAW_SCREENSHOT_MUST_NOT_ESCAPE';
const invalidSuggestion = JSON.stringify({ action: 'tap', diagnostic: modelOnlyMarker });
const validTap = JSON.stringify({ action: 'tap', target: 'Tap Me' });

function plan(runId: string) {
  return TestPlanSchema.parse({
    schemaVersion: 'itestagent.test-plan.v3',
    runId,
    projectProfileRef: `projects/${'a'.repeat(64)}/project-profile.json`,
    target: { type: 'current_workspace' },
    device: { kind: 'physical', physical: { selector: 'by_udid', udid: device.udid } },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: { device: ['appium'] },
    execution: {
      prefer: 'device_backend',
      fallback: 'abort',
      resolvedPath: 'device_backend',
      selectionReason: 'explicit_preference',
      features: ['Validation'],
      goal: 'Tap Tap Me once, confirm Taps: 1 is visible, and collect a screenshot.',
      assertions: [
        {
          id: 'visible-after-tap',
          caseId: 'Validation',
          source: 'user',
          conditions: [
            { type: 'element_visible', target: 'Taps: 1', description: 'The count is one.' },
          ],
        },
      ],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
    },
    artifacts: {
      collect: ['screenshot'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: { baseline: 'skip', baselineDomain: 'physical', thresholdRequired: false },
    safety: { defaultMode: 'ask', highRiskActions: [] },
  });
}

function readyPreflight(): PhysicalPreflightResult {
  return {
    status: 'ready',
    stage: 'ready',
    artifact: {
      sourceKind: 'build',
      sourcePath: '/fixture/Demo.app',
      appPath: '/fixture/Demo.app',
      bundleId: 'com.example.Demo',
      executable: 'Demo',
      supportedPlatforms: ['iPhoneOS'],
      architectures: ['arm64'],
      signingValid: true,
    },
    wda: {
      route: 'route_b_wda_manager_managed',
      stage: 'ready',
      ready: true,
      targetDeviceUdid: device.udid,
      targetWdaBundleId: 'com.example.WebDriverAgentRunner.xctrunner',
      waitedMs: 1,
    },
  };
}

async function scenario(input: {
  runId: string;
  generate: (prompt: string, signal?: AbortSignal) => Promise<string>;
  signal?: AbortSignal;
  cleanup?: BackendCleanupOutcome;
  cleanupError?: Error;
  denySensitiveAction?: boolean;
}) {
  const root = await mkdtemp(join(tmpdir(), 'itestagent-612-suggestion-recovery-'));
  roots.push(root);
  initStore(root);
  const core = createStoreCore(join(root, 'db', 'itestagent.db'));
  databases.push(core.sqlite);
  await core.driver.migrate();
  const store = createRunStore(core.db, root);
  const calls: string[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const progress: Array<{ stage: string; message: string }> = [];
  const permissions: string[] = [];
  let taps = 0;
  const backend = {
    name: 'appium',
    async launchApp(_input: unknown, signal?: AbortSignal) {
      calls.push('launch');
      signals.push(signal);
      return { success: true };
    },
    async getUiTree(_input: unknown, signal?: AbortSignal) {
      calls.push('tree');
      signals.push(signal);
      return {
        format: 'xml',
        capturedAt: new Date().toISOString(),
        raw: `<XCUIElementTypeApplication x="0" y="0" width="390" height="844"><XCUIElementTypeButton name="Tap Me" label="Tap Me" enabled="true" visible="true" x="40" y="100" width="100" height="40" /><XCUIElementTypeStaticText name="Taps: ${taps}" label="Taps: ${taps}" enabled="true" visible="true" x="40" y="160" width="100" height="40" /></XCUIElementTypeApplication>`,
      };
    },
    async tap(action: { accessibilityId?: string }, signal?: AbortSignal) {
      expect(action.accessibilityId).toBe('Tap Me');
      calls.push('tap');
      signals.push(signal);
      taps += 1;
      return { success: true };
    },
    async screenshot(_input: unknown, signal?: AbortSignal) {
      calls.push('screenshot');
      signals.push(signal);
      const path = join(root, 'runs', input.runId, 'staging', 'artifacts', 'fixture.png');
      await mkdir(join(root, 'runs', input.runId, 'staging', 'artifacts'), { recursive: true });
      await writeFile(path, screenshotOnlyMarker);
      return { id: 'fixture-screenshot', type: 'screenshot', path };
    },
  } as unknown as DeviceBackend;
  const execution = await executeProductionTestPlan({
    plan: plan(input.runId),
    workspace: '/fixture',
    device,
    bundleId: 'com.example.Demo',
    store,
    storeRoot: root,
    signal: input.signal,
    suggest: (suggestion) => suggestExplorationAction({ ...suggestion, generate: input.generate }),
    authorize: async (action) => {
      permissions.push(action);
      return !(input.denySensitiveAction && action === 'interact_sensitive_ui');
    },
    production: {
      analyzeWorkspace: async () => {
        throw new Error('Planning is not part of this execution regression.');
      },
      deviceDiscovery: {} as never,
      createDeviceBackend: () => backend,
      physicalPreflight: async () => readyPreflight(),
      closeDeviceBackend: async (_backend, signal) => {
        calls.push('cleanup');
        signals.push(signal);
        if (input.cleanupError) throw input.cleanupError;
        return input.cleanup ?? { status: 'closed', reusable: true, issues: [] };
      },
    },
    onProgress: (event) => progress.push(event),
  });
  const bundle = await store.loadRunBundle(input.runId);
  const publicReport = await Promise.all(
    ['result.json', 'steps.json', 'summary.md', 'artifact-index.json'].map((name) =>
      readFile(join(execution.runDir, name), 'utf8'),
    ),
  );
  expect(publicReport.join('\n')).not.toContain(modelOnlyMarker);
  expect(publicReport.join('\n')).not.toContain(screenshotOnlyMarker);
  expect(execution.error ?? '').not.toContain(modelOnlyMarker);
  expect(JSON.stringify(progress)).not.toContain(modelOnlyMarker);
  expect(existsSync(join(root, 'runs', input.runId, 'staging'))).toBe(false);
  return { execution, bundle, calls, signals, progress, permissions };
}

function expectRetainedEvidence(bundle: Awaited<ReturnType<typeof scenario>>['bundle']) {
  expect(bundle.steps.steps.map((step) => step.action)).toEqual(['launch', 'tap']);
  expect(bundle.steps.steps.map((step) => step.sequence)).toEqual([1, 2]);
  const tap = bundle.steps.steps[1];
  expect(tap).toMatchObject({ status: 'completed', caseId: 'Validation' });
  const screenshot = bundle.artifactIndex.artifacts.find(
    (artifact) => artifact.type === 'screenshot',
  );
  if (!tap || !screenshot) throw new Error('Expected the completed tap and screenshot evidence.');
  expect(screenshot).toMatchObject({
    relatedStep: tap?.stepId,
    relatedCase: 'Validation',
    redactionStatus: 'raw-local-only',
  });
  expect(tap?.artifacts).toContain(screenshot?.id);
  expect(bundle.result.cases[0]?.steps).toContain(tap?.stepId);
  expect(bundle.result.cases[0]?.artifacts).toContain(screenshot?.id);
  expect(bundle.result.artifactRefs).toContain(screenshot?.id);
  expect(bundle.artifactIndex.collectionOutcomes).toContainEqual(
    expect.objectContaining({ status: 'collected', artifactId: screenshot?.id }),
  );
  expect(bundle.result.execution.totalSteps).toBe(2);
}

describe('T6.12 production action repair and partial run preservation', () => {
  test('commits infra_failed with earlier steps and evidence after one unsuccessful format correction', async () => {
    const prompts: string[] = [];
    const responses = [validTap, invalidSuggestion, invalidSuggestion];
    const result = await scenario({
      runId: 'invalid-suggestion-after-tap',
      generate: async (prompt) => {
        prompts.push(prompt);
        return responses.shift() ?? '{"action":"done"}';
      },
    });
    expect(prompts).toHaveLength(3);
    expect(prompts.join('\n')).not.toContain(modelOnlyMarker);
    expect(result.execution).toMatchObject({ status: 'failed', path: 'device_backend' });
    expect(result.execution.error).toContain('exploration_suggestion_invalid');
    expect(result.bundle.result.status).toBe('infra_failed');
    expect(result.bundle.result.cases[0]?.status).not.toBe('passed');
    expect(result.calls.filter((call) => call === 'tap')).toHaveLength(1);
    expect(result.calls.filter((call) => call === 'screenshot')).toHaveLength(1);
    expect(result.calls.at(-1)).toBe('cleanup');
    expect(result.progress.filter((event) => event.stage === 'repairing_action')).toHaveLength(1);
    expectRetainedEvidence(result.bundle);
  });

  test('executes only the repaired action and completes with progress and the same signal', async () => {
    const controller = new AbortController();
    const generationSignals: Array<AbortSignal | undefined> = [];
    const responses = [invalidSuggestion, validTap, '{"action":"done"}'];
    const result = await scenario({
      runId: 'repaired-suggestion-success',
      signal: controller.signal,
      generate: async (_prompt, signal) => {
        generationSignals.push(signal);
        return responses.shift() ?? '{"action":"done"}';
      },
    });
    expect(result.execution.status).toBe('completed');
    expect(result.bundle.result.status).toBe('passed');
    expect(generationSignals).toEqual([controller.signal, controller.signal, controller.signal]);
    expect(result.signals.every((signal) => signal === controller.signal)).toBe(true);
    expect(result.calls.filter((call) => call === 'tap')).toHaveLength(1);
    expect(result.progress.filter((event) => event.stage === 'repairing_action')).toHaveLength(1);
    expectRetainedEvidence(result.bundle);
  });

  test('preserves earlier evidence when cleanup also fails after invalid output', async () => {
    const responses = [validTap, invalidSuggestion, invalidSuggestion];
    const result = await scenario({
      runId: 'invalid-suggestion-and-cleanup',
      generate: async () => responses.shift() ?? '{"action":"done"}',
      cleanup: { status: 'failed', reusable: false, issues: ['fixture cleanup failure'] },
    });
    expect(result.execution.cleanupOutcome).toMatchObject({ status: 'failed', reusable: false });
    expect(result.execution.error).toContain('exploration_suggestion_invalid');
    expect(result.execution.error).toContain('fixture cleanup failure');
    expect(result.bundle.result.status).toBe('infra_failed');
    expectRetainedEvidence(result.bundle);
  });

  test('preserves the partial run when the cleanup adapter rejects', async () => {
    const responses = [validTap, invalidSuggestion, invalidSuggestion];
    const result = await scenario({
      runId: 'invalid-suggestion-cleanup-rejected',
      generate: async () => responses.shift() ?? '{"action":"done"}',
      cleanupError: new Error('Fixture cleanup adapter rejected.'),
    });
    expect(result.execution.cleanupOutcome).toMatchObject({ status: 'failed', reusable: false });
    expect(result.execution.error).toContain('exploration_suggestion_invalid');
    expect(result.bundle.result.status).toBe('infra_failed');
    expectRetainedEvidence(result.bundle);
  });

  test('a repaired sensitive action still requires permission and denial prevents dispatch', async () => {
    const responses = [invalidSuggestion, '{"action":"tap","target":"Delete account"}'];
    const result = await scenario({
      runId: 'repaired-sensitive-suggestion-denied',
      generate: async () => responses.shift() ?? '{"action":"done"}',
      denySensitiveAction: true,
    });
    expect(responses).toHaveLength(0);
    expect(result.permissions).toContain('interact_sensitive_ui');
    expect(result.execution.status).toBe('failed');
    expect(result.execution.error).toContain('exploration_permission_denied');
    expect(result.bundle.result.status).not.toBe('passed');
    expect(result.calls).toEqual(['launch', 'tree', 'cleanup']);
    expect(result.bundle.steps.steps.map((step) => step.action)).toEqual(['launch']);
    expect(result.bundle.artifactIndex.artifacts).toHaveLength(0);
    expect(result.progress.filter((event) => event.stage === 'repairing_action')).toHaveLength(1);
  });

  test('commits cancelled with prior evidence when cancelled during the corrective generation', async () => {
    const controller = new AbortController();
    let correctionStarted: () => void = () => {};
    const correction = new Promise<void>((resolve) => {
      correctionStarted = resolve;
    });
    let generations = 0;
    const pending = scenario({
      runId: 'cancel-during-suggestion-correction',
      signal: controller.signal,
      generate: async (_prompt, signal) => {
        generations += 1;
        if (generations === 1) return validTap;
        if (generations === 2) return invalidSuggestion;
        expect(signal).toBe(controller.signal);
        correctionStarted();
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    await correction;
    controller.abort(new DOMException('User cancelled', 'AbortError'));
    const result = await pending;
    expect(generations).toBe(3);
    expect(result.execution.status).toBe('cancelled');
    expect(result.bundle.result.status).toBe('cancelled');
    expect(result.bundle.result.cases[0]?.status).toBe('cancelled');
    expect(result.calls.filter((call) => call === 'tap')).toHaveLength(1);
    expect(result.calls.at(-1)).toBe('cleanup');
    expectRetainedEvidence(result.bundle);
  });
});
