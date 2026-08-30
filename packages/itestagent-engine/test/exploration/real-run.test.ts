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
import type { ExplorerToolDispatcher } from '../../src/exploration/device-explorer.js';
import {
  createBackendToolDispatcher,
  runRealDeviceExploration,
} from '../../src/exploration/real-run.js';

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

describe('runRealDeviceExploration', () => {
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
        actions: [{ action: 'screenshot', target: 'capture' }],
        assertions: [userAssertion()],
        artifactRefs: [{ id: 'shot_1', type: 'screenshot', path: join(tmpdir(), 'shot_1.png') }],
      });

      expect(result.assertion.status).toBe('passed');
      expect(result.assertion.cases[0]?.resolvedBy).toBe('user');
      expect(result.artifactCount).toBe(1);
      expect(result.artifactIndexPath).not.toBeNull();

      const indexPath = result.artifactIndexPath ?? '';
      const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as {
        runId: string;
        artifacts: { id: string }[];
      };
      expect(index.runId).toBe('run_test_1');
      expect(index.artifacts).toHaveLength(1);
      // explorer recorded the screenshot step
      expect(result.steps.some((s) => s.action === 'screenshot')).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('reports failed for an unsatisfied user assertion', async () => {
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
        actions: [],
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
      actions: [],
    });
    expect(result.assertion.status).toBe('explored');
  });
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
      actions: [],
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
