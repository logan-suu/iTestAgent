/**
 * Real-device run composition tests — mock backend, no device required.
 *
 * Verifies: explorer runs against the injected backend, observations map to
 * the evaluator (user assertion visible → passed), and artifact-index.json
 * is persisted from dispatcher-captured refs.
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UserAssertion } from 'itestagent-contracts';
import { createArtifactStore } from 'itestagent-store';
import { DeviceBackendExecutionError } from '../../src/device-execution-error.js';
import type { ExplorerToolDispatcher } from '../../src/exploration/device-explorer.js';
import {
  createBackendToolDispatcher,
  isSensitiveUiAction,
  runRealDeviceExploration,
  suggestExplorationAction,
} from '../../src/exploration/real-run.js';
import type { RealDeviceRunResult } from '../../src/exploration/real-run.js';

const TREE = `<XCUIElementTypeApplication><XCUIElementTypeButton name="login_button" label="Log in" /></XCUIElementTypeApplication>`;

function makeBackend(calls: { tool: string }[]) {
  return {
    async getUiTree(_input: { deviceId: string }) {
      calls.push({ tool: 'get_ui_tree' });
      return { raw: TREE, format: 'xml', capturedAt: new Date().toISOString() };
    },
    async launchApp(_input: { bundleId: string }) {
      return { success: true as const, message: 'launched' };
    },
    async screenshot(_input: { deviceId: string }) {
      calls.push({ tool: 'screenshot' });
      const id = `shot_${calls.length}`;
      const path = join(tmpdir(), `${id}.png`);
      return { id, type: 'screenshot', path };
    },
  };
}

function makeDispatcher(backend: ReturnType<typeof makeBackend>): ExplorerToolDispatcher {
  return {
    async dispatch(call) {
      const args = call.arguments as Record<string, string | undefined>;
      if (call.name === 'get_ui_tree') {
        const tree = await backend.getUiTree({ deviceId: String(args.deviceId ?? '') });
        return { callId: call.id, status: 'ok', output: { raw: tree.raw, format: tree.format } };
      }
      if (call.name === 'launch_app') {
        const result = await backend.launchApp({ bundleId: String(args.bundleId ?? '') });
        return { callId: call.id, status: result.success ? 'ok' : 'error', output: result };
      }
      if (call.name === 'screenshot') {
        const ref = await backend.screenshot({ deviceId: String(args.deviceId ?? '') });
        return {
          callId: call.id,
          status: 'ok',
          output: ref,
          artifacts: [
            {
              id: ref.id,
              type: 'screenshot' as const,
              path: ref.path,
              redactionStatus: 'safe' as const,
            },
          ],
        };
      }
      return { callId: call.id, status: 'error', output: { error: `unsupported ${call.name}` } };
    },
  };
}

function userAssertion(): UserAssertion {
  return {
    id: 'ua1',
    caseId: 'login',
    source: 'user',
    conditions: [
      {
        type: 'element_visible',
        target: 'login_button',
        description: 'login button visible',
      },
    ],
  };
}

describe('createBackendToolDispatcher', () => {
  it('returns an error result and indexes nothing when a screenshot has an empty path', async () => {
    const backend = {
      async getUiTree() {
        return { raw: '<XCUIElementTypeApplication />', format: 'xml', capturedAt: '' };
      },
      async launchApp() {
        return { success: true as const, message: 'launched' };
      },
      async screenshot() {
        return { id: 'screenshot_error_1', type: 'screenshot', path: '' };
      },
    };
    const dispatcher = createBackendToolDispatcher(backend);
    const result = await dispatcher.dispatch({
      id: 'c1',
      name: 'screenshot',
      arguments: { deviceId: 'UDID-1' },
    });
    expect(result.status).toBe('error');
    expect(dispatcher.getArtifactRefs()).toHaveLength(0);
  });
});

describe('model-safe exploration boundary', () => {
  it('redacts secrets before invoking the model', async () => {
    let prompt = '';
    await suggestExplorationAction({
      caseId: 'login',
      uiTree:
        '<XCUIElementTypeSecureTextField value="password=super-secret-value"/><XCUIElementTypeStaticText label="OTP 123456"/>',
      history: [],
      generate: async (value) => {
        prompt = value;
        return '{"action":"done"}';
      },
    });
    expect(prompt).not.toContain('super-secret-value');
    expect(prompt).not.toContain('123456');
    expect(prompt).toContain('[REDACTED]');
  });

  it('includes the confirmed goal and success criteria in the action prompt', async () => {
    let prompt = '';
    await suggestExplorationAction({
      caseId: 'Validation',
      goal: 'Tap the button and confirm the count.',
      assertions: [userAssertion()],
      uiTree: '<App/>',
      history: [],
      generate: async (value) => {
        prompt = value;
        return '{"action":"done"}';
      },
    });
    expect(prompt).toContain('GOAL: Tap the button and confirm the count.');
    expect(prompt).toContain('SUCCESS CRITERIA:');
    expect(prompt).toContain('login button visible');
  });

  it('forwards the run AbortSignal to model generation', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    await suggestExplorationAction({
      caseId: 'login',
      uiTree: '<App/>',
      history: [],
      signal: controller.signal,
      generate: async (_prompt, signal) => {
        received = signal;
        return '{"action":"done"}';
      },
    });
    expect(received).toBe(controller.signal);
  });

  it.each(['started', 'unavailable'] as const)(
    'separates collector waits from the confirmed workload when capture is %s',
    async (captureStatus) => {
      const prompts: string[] = [];
      const goal = '点击按钮，等待20秒，确认完成；采集内存增长，观察70秒，操作后等待10秒。';
      const action = await suggestExplorationAction({
        caseId: 'validation',
        goal,
        performanceObservation: {
          captureStatus,
          minimumDurationMs: 70000,
          settleDurationMs: 10000,
        },
        uiTree: '<App/>',
        history: [],
        generate: async (prompt) => {
          prompts.push(prompt);
          return prompts.length === 1 ? '{}' : '{"action":"wait","waitMs":20000}';
        },
      });
      expect(action).toEqual({ action: 'wait', target: 'wait_20000ms', waitMs: 20000 });
      expect(prompts).toHaveLength(2);
      for (const prompt of prompts) {
        expect(prompt).toContain(`GOAL: ${goal}`);
        expect(prompt).toContain(`captureStatus=${captureStatus}`);
        expect(prompt).toContain('minimumDurationMs=70000; settleDurationMs=10000');
        expect(prompt).toContain(
          'Do not convert performance observation, settling, or sampling allowance into UI wait actions.',
        );
        expect(prompt).toContain(
          'Keep explicit workload waits, even if their duration equals a performance duration.',
        );
        if (captureStatus === 'unavailable')
          expect(prompt).toContain(
            'Do not try to replace missing capture with waits or repeated workload actions.',
          );
      }
    },
  );

  it('normalizes targetless observation actions while keeping element actions strict', async () => {
    const screenshot = await suggestExplorationAction({
      caseId: 'validation',
      uiTree: '<App/>',
      history: [],
      generate: async () => '{"action":"screenshot"}',
    });
    const swipe = await suggestExplorationAction({
      caseId: 'validation',
      uiTree: '<App/>',
      history: [],
      generate: async () => '{"action":"swipe","direction":"up"}',
    });
    const wait = await suggestExplorationAction({
      caseId: 'validation',
      uiTree: '<App/>',
      history: [],
      generate: async () => '{"action":"wait","waitMs":250}',
    });
    const aliasedTap = await suggestExplorationAction({
      caseId: 'validation',
      uiTree: '<App/>',
      history: [],
      generate: async () => '{"action":"tap","accessibilityId":"Tap Me"}',
    });
    const labelledInput = await suggestExplorationAction({
      caseId: 'validation',
      uiTree: '<App/>',
      history: [],
      generate: async () => '{"action":"input","label":"Name","text":"Logan"}',
    });

    expect(screenshot).toEqual({ action: 'screenshot', target: 'screenshot' });
    expect(swipe).toEqual({ action: 'swipe', target: 'swipe_up', direction: 'up' });
    expect(wait).toEqual({ action: 'wait', target: 'wait_250ms', waitMs: 250 });
    expect(aliasedTap).toEqual({ action: 'tap', target: 'Tap Me' });
    expect(labelledInput).toEqual({ action: 'input', target: 'Name', text: 'Logan' });
    await expect(
      suggestExplorationAction({
        caseId: 'validation',
        uiTree: '<App/>',
        history: [],
        generate: async () => '{"action":"tap"}',
      }),
    ).rejects.toThrow('target, accessibilityId, or label is required');
    await expect(
      suggestExplorationAction({
        caseId: 'validation',
        uiTree: '<App/>',
        history: [],
        generate: async () => '{"action":"input","text":"hello"}',
      }),
    ).rejects.toThrow('target, accessibilityId, or label is required');
  });

  it('classifies sensitive UI semantics independently of the verb', () => {
    expect(isSensitiveUiAction({ action: 'tap', target: 'Delete account' })).toBe(true);
    expect(isSensitiveUiAction({ action: 'tap', target: 'Open settings' })).toBe(false);
  });
});

describe('runRealDeviceExploration', () => {
  it('fails before reading the interface when the application launch fails', async () => {
    let uiReads = 0;
    const backend = {
      async launchApp() {
        return { success: false, error: 'application is not installed' };
      },
      async getUiTree() {
        uiReads += 1;
        return { raw: '<App/>', format: 'xml', capturedAt: new Date().toISOString() };
      },
      async screenshot() {
        return { id: 'unused', type: 'screenshot', path: '/tmp/unused.png' };
      },
    };
    const runDir = mkdtempSync(join(tmpdir(), 'real-run-launch-failure-'));
    try {
      await expect(
        runRealDeviceExploration({
          backend,
          toolDispatcher: createBackendToolDispatcher(backend),
          runDir,
          runId: 'run_launch_failure',
          bundleId: 'com.example.app',
          deviceId: 'UDID-1',
          targetKind: 'physical',
          dynamicActions: { cases: ['validation'], suggest: async () => 'done' },
        }),
      ).rejects.toThrow('app_launch_failed');
      expect(uiReads).toBe(0);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('reports truthful execution stages without exposing UI-tree content', async () => {
    const progress: string[] = [];
    const backend = makeBackend([]);
    const runDir = mkdtempSync(join(tmpdir(), 'real-run-progress-'));
    try {
      await runRealDeviceExploration({
        backend,
        toolDispatcher: makeDispatcher(backend),
        runDir,
        runId: 'run_progress_1',
        bundleId: 'com.example.app',
        deviceId: 'UDID-1',
        targetKind: 'physical',
        dynamicActions: {
          cases: ['validation'],
          suggest: async () => 'done',
        },
        onProgress: ({ message }) => progress.push(message),
      });

      expect(progress).toEqual([
        'Launching the app and preparing the first observation…',
        'Reading the interface for validation (step 1)…',
        'Waiting for the next safe action for validation…',
        'Evaluating the confirmed assertions…',
        'Indexing the collected local evidence…',
      ]);
      expect(progress.join('\n')).not.toContain(TREE);
      expect(progress.join('\n')).not.toContain('UDID-1');
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('explodes actions, evaluates a satisfied user assertion to passed, and persists artifact-index', async () => {
    const calls: { tool: string }[] = [];
    const backend = makeBackend(calls);
    const runDir = mkdtempSync(join(tmpdir(), 'real-run-'));
    try {
      const result = await runRealDeviceExploration({
        backend,
        toolDispatcher: makeDispatcher(backend),
        runDir,
        runId: 'run_test_1',
        bundleId: 'com.example.app',
        deviceId: 'UDID-1',
        targetKind: 'physical',
        publishLegacyArtifactIndex: true,
        actions: [{ action: 'screenshot', target: 'capture', caseId: 'login' }],
        assertions: [userAssertion()],
        artifactRefs: [{ id: 'shot_1', type: 'screenshot', path: join(tmpdir(), 'shot_1.png') }],
      });

      expect(result.assertion.status).toBe('passed');
      expect(result.assertion.cases[0]?.resolvedBy).toBe('user');
      expect(result.artifactCount).toBe(2);
      expect(result.artifactIndexPath).not.toBeNull();

      const indexPath = result.artifactIndexPath ?? '';
      const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as {
        runId: string;
        artifacts: { id: string }[];
      };
      expect(index.runId).toBe('run_test_1');
      expect(index.artifacts.map((artifact) => artifact.id).sort()).toEqual(['shot_1', 'shot_2']);
      // explorer recorded the screenshot step
      expect(result.steps.some((s) => s.action === 'screenshot')).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('reports failed for an unsatisfied user assertion at its immediate checkpoint', async () => {
    const calls: { tool: string }[] = [];
    const backend = {
      async getUiTree(_input: { deviceId: string }) {
        calls.push({ tool: 'get_ui_tree' });
        return { raw: '<XCUIElementTypeApplication />', format: 'xml', capturedAt: '' };
      },
      async launchApp(_input: { bundleId: string }) {
        return { success: true as const, message: 'launched' };
      },
      async screenshot(_input: { deviceId: string }) {
        return { id: 's1', type: 'screenshot', path: '/tmp/s1.png' };
      },
    };
    const dispatcher: ExplorerToolDispatcher = {
      async dispatch(call) {
        return { callId: call.id, status: 'ok', output: { raw: '' } };
      },
    };
    const runDir = mkdtempSync(join(tmpdir(), 'real-run-'));
    try {
      const result = await runRealDeviceExploration({
        backend,
        toolDispatcher: dispatcher,
        runDir,
        runId: 'run_test_2',
        bundleId: 'com.example.app',
        deviceId: 'UDID-1',
        targetKind: 'physical',
        actions: [{ action: 'wait', target: 'settle login', waitMs: 1, caseId: 'login' }],
        assertions: [userAssertion()],
      });
      expect(result.assertion.status).toBe('failed');
      expect(result.artifactCount).toBe(0);
      expect(result.artifactIndexPath).toBeNull();
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('falls back to explored when no assertions are provided', async () => {
    const backend = makeBackend([]);
    const result = await runRealDeviceExploration({
      backend,
      toolDispatcher: makeDispatcher(backend),
      runDir: mkdtempSync(join(tmpdir(), 'real-run-')),
      runId: 'run_test_3',
      bundleId: 'com.example.app',
      deviceId: 'UDID-1',
      targetKind: 'physical',
      actions: [{ action: 'wait', target: 'observe login', waitMs: 1, caseId: 'login' }],
    });
    expect(result.assertion.status).toBe('explored');
  });

  it('blocks a sensitive generated action when no permission authorizer is wired', async () => {
    const backend = makeBackend([]);
    await expect(
      runRealDeviceExploration({
        backend,
        toolDispatcher: makeDispatcher(backend),
        runDir: mkdtempSync(join(tmpdir(), 'real-run-')),
        runId: 'run_sensitive',
        bundleId: 'com.example.app',
        deviceId: 'UDID-1',
        targetKind: 'physical',
        dynamicActions: {
          cases: ['account'],
          maxStepsPerCase: 1,
          suggest: async () => ({ action: 'tap', target: 'Delete account' }),
        },
      }),
    ).rejects.toThrow('exploration_permission_required');
  });

  it('stops repeated unchanged actions and reports an inconclusive no-progress outcome', async () => {
    const progress: string[] = [];
    const backend = makeBackend([]);
    const runDir = mkdtempSync(join(tmpdir(), 'real-run-stalled-'));
    try {
      const result = await runRealDeviceExploration({
        backend,
        toolDispatcher: makeDispatcher(backend),
        runDir,
        runId: 'run_stalled',
        bundleId: 'com.example.app',
        deviceId: 'UDID-1',
        targetKind: 'physical',
        dynamicActions: {
          cases: ['validation'],
          suggest: async () => ({ action: 'wait', target: 'wait_1ms', waitMs: 1 }),
        },
        onProgress: ({ message }) => progress.push(message),
      });

      expect(result.steps.filter((step) => step.caseId === 'validation')).toHaveLength(2);
      expect(result.explorationTermination?.reason).toBe('no_progress');
      expect(result.assertion.status).toBe('inconclusive');
      expect(progress.some((message) => message.includes('stalled'))).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe('runRealDeviceExploration partial evidence on terminal failure', () => {
  for (const failureKind of ['format', 'provider', 'observation'] as const) {
    it(`retains completed actions and local evidence after a later ${failureKind} failure`, async () => {
      const runDir = mkdtempSync(join(tmpdir(), 'real-run-partial-evidence-'));
      const artifactStore = createArtifactStore(join(runDir, 'artifacts'));
      const rawTree = '<App><StaticText label="RAW_LOCAL_CHECKPOINT_SENTINEL"/></App>';
      let uiReads = 0;
      let screenshots = 0;
      let launches = 0;
      let modelCalls = 0;
      const backend = {
        async launchApp() {
          launches += 1;
          return { success: true as const, message: 'launched' };
        },
        async screenshot() {
          screenshots += 1;
          return artifactStore.put({
            type: 'screenshot',
            data: Buffer.from('SYNTHETIC_SCREENSHOT_FIXTURE'),
            mimeType: 'image/png',
          });
        },
        async getUiTree() {
          uiReads += 1;
          if (failureKind === 'observation' && uiReads === 4) {
            throw new Error('observation transport stopped');
          }
          return { raw: rawTree, format: 'xml', capturedAt: '2026-09-07T12:00:00Z' };
        },
      };
      try {
        const failure = await runRealDeviceExploration({
          backend,
          toolDispatcher: createBackendToolDispatcher(backend),
          artifactStore,
          runDir,
          runId: 'run_partial_evidence',
          bundleId: 'com.example.app',
          deviceId: 'UDID-1',
          targetKind: 'physical',
          exploration: { settleMs: 0 },
          dynamicActions: {
            cases: ['Validation'],
            suggest: (context) =>
              suggestExplorationAction({
                ...context,
                goal: 'Capture a screenshot, then inspect the interface.',
                generate: async () => {
                  modelCalls += 1;
                  if (modelCalls === 1) return '{"action":"screenshot"}';
                  if (failureKind === 'provider') throw new Error('provider transport stopped');
                  return '{"action":"tap","target":{"label":"REJECTED_SUGGESTION_SENTINEL"}}';
                },
              }),
          },
        }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(DeviceBackendExecutionError);
        const executionError = failure as DeviceBackendExecutionError;
        expect(executionError.message).toContain(
          failureKind === 'format'
            ? 'exploration_suggestion_invalid'
            : `${failureKind} transport stopped`,
        );
        const partial = executionError.partialResult as RealDeviceRunResult;
        expect(partial.steps.map((step) => [step.action, step.status])).toEqual([
          ['launch', 'completed'],
          ['screenshot', 'completed'],
        ]);
        expect(partial.assertion.status).toBe('inconclusive');
        expect(partial.assertion.cases.map((entry) => entry.caseId)).toEqual(['Validation']);
        expect(partial.artifactCount).toBe(2);
        expect(partial.artifacts.map((artifact) => artifact.type).sort()).toEqual([
          'screenshot',
          'uitree',
        ]);
        const screenshotStep = partial.steps.find((step) => step.action === 'screenshot');
        expect(screenshotStep?.artifacts).toHaveLength(2);
        for (const artifact of partial.artifacts) {
          expect(artifact.redactionStatus).toBe('raw-local-only');
          expect(artifact.relatedCase).toBe('Validation');
          expect(artifact.relatedStep).toBe(screenshotStep?.stepId);
          expect(screenshotStep?.artifacts).toContain(artifact.id);
          expect(await artifactStore.get(artifact.id)).not.toBeNull();
          expect(readFileSync(join(runDir, 'artifacts', artifact.path), 'utf8')).toBe(
            artifact.type === 'uitree' ? rawTree : 'SYNTHETIC_SCREENSHOT_FIXTURE',
          );
        }
        expect(JSON.stringify(partial)).not.toContain('RAW_LOCAL_CHECKPOINT_SENTINEL');
        expect(JSON.stringify(partial)).not.toContain('SYNTHETIC_SCREENSHOT_FIXTURE');
        expect(JSON.stringify(partial)).not.toContain('REJECTED_SUGGESTION_SENTINEL');
        expect(executionError.message).not.toContain('REJECTED_SUGGESTION_SENTINEL');
        expect(launches).toBe(1);
        expect(screenshots).toBe(1);
        expect(uiReads).toBe(4);
        expect(modelCalls).toBe(failureKind === 'format' ? 3 : failureKind === 'provider' ? 2 : 1);
      } finally {
        rmSync(runDir, { recursive: true, force: true });
      }
    });
  }
});

// ─── 批2-2: LLM suggestion wiring (US-11.1 AC4 chain) ──────────────

describe('runRealDeviceExploration llmSuggest', () => {
  const TREE = `<XCUIElementTypeButton name="login_button" label="Log in" />`;

  function llmBackend() {
    return {
      async getUiTree(_input: { deviceId: string }) {
        return { raw: TREE, format: 'xml', capturedAt: '' };
      },
      async screenshot(_input: { deviceId: string }) {
        return { id: 's1', type: 'screenshot', path: '/tmp/s1.png' };
      },
      async launchApp(_input: { bundleId: string }) {
        return { success: true as const, message: 'launched' };
      },
    };
  }

  const SUGGESTIONS_JSON = JSON.stringify([
    {
      id: 's1',
      caseId: 'login',
      label: 'login button visible',
      conditions: [
        { type: 'element_visible', description: 'login button is visible', target: 'login_button' },
      ],
      evidence: ['name="login_button" in tree'],
    },
  ]);

  it('proposes LLM suggestions as needs_assertion when no user/profile assertions', async () => {
    const result = await runRealDeviceExploration({
      backend: llmBackend(),
      toolDispatcher: makeDispatcher(llmBackend()),
      runDir: mkdtempSync(join(tmpdir(), 'real-run-llm-')),
      runId: 'run_llm_1',
      bundleId: 'com.example.app',
      deviceId: 'UDID-1',
      targetKind: 'physical',
      actions: [],
      llmSuggest: { generate: async () => SUGGESTIONS_JSON, goal: 'login works' },
    });
    expect(result.assertion.status).toBe('needs_assertion');
    expect(result.assertion.suggestions ?? []).toHaveLength(1);
    expect((result.assertion.suggestions ?? [])[0]?.source).toBe('agent');
    expect(result.llmSuggestions).toHaveLength(1);
  });

  it('does not call the LLM when user assertions are present', async () => {
    let called = 0;
    const result = await runRealDeviceExploration({
      backend: llmBackend(),
      toolDispatcher: makeDispatcher(llmBackend()),
      runDir: mkdtempSync(join(tmpdir(), 'real-run-llm-')),
      runId: 'run_llm_2',
      bundleId: 'com.example.app',
      deviceId: 'UDID-1',
      targetKind: 'physical',
      actions: [{ action: 'wait', target: 'observe login', waitMs: 1, caseId: 'login' }],
      assertions: [userAssertion()],
      llmSuggest: {
        generate: async () => {
          called += 1;
          return SUGGESTIONS_JSON;
        },
        goal: 'login works',
      },
    });
    expect(called).toBe(0);
    expect(result.assertion.status).toBe('passed');
    expect(result.llmSuggestions).toHaveLength(0);
  });
});

// ─── 批2-1a: interaction primitive routes in the dispatcher ────────

describe('createBackendToolDispatcher interaction routes', () => {
  const recorded: { tool: string; args: Record<string, unknown> }[] = [];

  function interactiveBackend(partial?: Record<string, never>) {
    return {
      async getUiTree(_input: { deviceId: string }) {
        return { raw: '<a />', format: 'xml', capturedAt: '' };
      },
      async screenshot(_input: { deviceId: string }) {
        return { id: 's', type: 'screenshot', path: '/tmp/s.png' };
      },
      async launchApp(_input: { bundleId: string }) {
        return { success: true as const };
      },
      async tap(input: { deviceId: string; x: number; y: number }) {
        recorded.push({ tool: 'tap', args: input as unknown as Record<string, unknown> });
        return { success: true as const, message: 'tapped' };
      },
      async swipe(input: {
        deviceId: string;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
      }) {
        recorded.push({ tool: 'swipe', args: input as unknown as Record<string, unknown> });
        return { success: true as const, message: 'swiped' };
      },
      async typeText(input: { deviceId: string; text: string }) {
        recorded.push({ tool: 'typeText', args: input as unknown as Record<string, unknown> });
        return { success: true as const, message: 'typed' };
      },
      async pressButton(input: { deviceId: string; button: string }) {
        recorded.push({ tool: 'pressButton', args: input as unknown as Record<string, unknown> });
        return { success: true as const, message: 'pressed' };
      },
      ...partial,
    };
  }

  it('routes tap with numeric coordinates', async () => {
    const dispatcher = createBackendToolDispatcher(interactiveBackend());
    const r = await dispatcher.dispatch({
      id: 't1',
      name: 'tap',
      arguments: { deviceId: 'U1', x: 100, y: 200 },
    });
    expect(r.status).toBe('ok');
    expect(recorded.at(-1)).toEqual({ tool: 'tap', args: { deviceId: 'U1', x: 100, y: 200 } });
  });

  it('routes swipe, type_text and press_button', async () => {
    const dispatcher = createBackendToolDispatcher(interactiveBackend());
    const swipe = await dispatcher.dispatch({
      id: 't2',
      name: 'swipe',
      arguments: { deviceId: 'U1', fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3 },
    });
    expect(swipe.status).toBe('ok');
    const typed = await dispatcher.dispatch({
      id: 't3',
      name: 'type_text',
      arguments: { deviceId: 'U1', text: 'hello' },
    });
    expect(typed.status).toBe('ok');
    const pressed = await dispatcher.dispatch({
      id: 't4',
      name: 'press_button',
      arguments: { deviceId: 'U1', button: 'home' },
    });
    expect(pressed.status).toBe('ok');
    expect(recorded.map((r) => r.tool)).toEqual(['tap', 'swipe', 'typeText', 'pressButton']);
  });

  it('returns an error route when the backend lacks the capability', async () => {
    const backend = interactiveBackend();
    const dispatcher = createBackendToolDispatcher(backend);
    const r = await dispatcher.dispatch({
      id: 't5',
      name: 'tap',
      arguments: { deviceId: 'U1', x: 1, y: 2 },
    });
    expect(r.status).toBe('ok'); // backend implements tap — ok
    const sparse = createBackendToolDispatcher({
      getUiTree: async () => ({ raw: '', format: 'xml', capturedAt: '' }),
      screenshot: async () => ({ id: 's', type: 'screenshot', path: '' }),
      launchApp: async () => ({ success: true as const }),
      tap: undefined,
      swipe: undefined,
      typeText: undefined,
      pressButton: undefined,
    } as unknown as Parameters<typeof createBackendToolDispatcher>[0]);
    const blocked = await sparse.dispatch({
      id: 't6',
      name: 'tap',
      arguments: { deviceId: 'U1', x: 1, y: 2 },
    });
    expect(blocked.status).toBe('error');
    expect((blocked.output as { error: string }).error).toContain('does not support tap');
  });
});
