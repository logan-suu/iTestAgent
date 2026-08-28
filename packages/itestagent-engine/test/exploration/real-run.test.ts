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
import { runRealDeviceExploration } from '../../src/exploration/real-run.js';

const TREE = `<XCUIElementTypeApplication><XCUIElementTypeButton name="login_button" label="Log in" /></XCUIElementTypeApplication>`;

function makeBackend(calls: { tool: string }[]) {
  return {
    async getUiTree(_input: { udid?: string }) {
      calls.push({ tool: 'get_ui_tree' });
      return { raw: TREE, format: 'xml', capturedAt: new Date().toISOString() };
    },
    async launchApp(_input: { bundleId: string }) {
      return { success: true as const, message: 'launched' };
    },
    async screenshot(_input: { udid?: string }) {
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
        const tree = await backend.getUiTree({ udid: args.deviceId });
        return { callId: call.id, status: 'ok', output: { raw: tree.raw, format: tree.format } };
      }
      if (call.name === 'screenshot') {
        const ref = await backend.screenshot({ udid: args.deviceId });
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
      async getUiTree(_input: { udid?: string }) {
        calls.push({ tool: 'get_ui_tree' });
        return { raw: '<XCUIElementTypeApplication />', format: 'xml', capturedAt: '' };
      },
      async launchApp(_input: { bundleId: string }) {
        return { success: true as const, message: 'launched' };
      },
      async screenshot(_input: { udid?: string }) {
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
