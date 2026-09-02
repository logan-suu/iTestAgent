import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ArtifactInput,
  ArtifactRef,
  ArtifactStore,
  UserAssertion,
} from 'itestagent-contracts';
import {
  createBackendToolDispatcher,
  runRealDeviceExploration,
  suggestExplorationAction,
} from 'itestagent-engine';

function assertion(caseId: string, target: string): UserAssertion {
  return {
    id: `assert-${caseId}`,
    caseId,
    source: 'user',
    conditions: [{ type: 'element_visible', target, description: `${target} is visible` }],
  };
}

describe('Task 6.6 case-scoped exploration', () => {
  it('uses the immediate checkpoint for each case and records canonical step ownership', async () => {
    let currentCase = 'initial';
    const lifecycle: string[] = [];
    const backend = {
      async getUiTree() {
        lifecycle.push('observe');
        return {
          raw: `<XCUIElementTypeApplication><XCUIElementTypeButton name="target_${currentCase}" /></XCUIElementTypeApplication>`,
          format: 'xml',
          capturedAt: new Date().toISOString(),
        };
      },
      async launchApp() {
        lifecycle.push('launch');
        return { success: true as const };
      },
      async screenshot() {
        return { id: 'shot', type: 'screenshot', path: '/tmp/shot.png' };
      },
    };
    const stored: ArtifactInput[] = [];
    const refs = new Map<string, ArtifactRef>();
    const artifactStore: ArtifactStore = {
      async put(input) {
        stored.push(input);
        const id = `artifact-${stored.length}`;
        const ref: ArtifactRef = {
          id,
          type: input.type,
          path: `artifacts/${id}.xml`,
          relatedStep: input.relatedStep,
          relatedCase: input.relatedCase,
          redactionStatus: 'safe',
        };
        refs.set(id, ref);
        return ref;
      },
      async get(id) {
        return refs.get(id) ?? null;
      },
      async search() {
        return [...refs.values()];
      },
    };
    const suggestions = new Map<string, number>();
    const runDir = mkdtempSync(join(tmpdir(), 'itestagent-6-6-'));
    try {
      const result = await runRealDeviceExploration({
        backend,
        toolDispatcher: createBackendToolDispatcher(backend),
        artifactStore,
        runDir,
        runId: 'run-6-6',
        bundleId: 'com.example.app',
        deviceId: 'UDID-1',
        targetKind: 'physical',
        dynamicActions: {
          cases: ['case-a', 'case-b'],
          maxStepsPerCase: 2,
          async suggest({ caseId }) {
            lifecycle.push(`suggest:${caseId}`);
            const count = suggestions.get(caseId) ?? 0;
            suggestions.set(caseId, count + 1);
            if (count > 0) return 'done';
            currentCase = caseId;
            return { action: 'wait', target: `settle ${caseId}`, waitMs: 1 };
          },
        },
        assertions: [assertion('case-a', 'target_case-a'), assertion('case-b', 'target_case-b')],
        exploration: { settleMs: 0 },
      });

      expect(result.assertion.status).toBe('passed');
      expect(lifecycle.indexOf('launch')).toBeLessThan(lifecycle.indexOf('suggest:case-a'));
      expect(result.steps.map((step) => step.sequence)).toEqual([1, 2, 3]);
      expect(result.steps.filter((step) => step.caseId).map((step) => step.caseId)).toEqual([
        'case-a',
        'case-b',
      ]);
      expect(stored.map((input) => input.relatedCase)).toEqual(['case-a', 'case-b']);
      expect(stored.every((input) => typeof input.relatedStep === 'string')).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('blocks unsupported or high-risk Agent actions instead of executing them', async () => {
    await expect(
      suggestExplorationAction({
        generate: async () => '{"action":"clear_app_data","target":"app"}',
        caseId: 'case-a',
        uiTree: '<Application />',
        history: [],
      }),
    ).rejects.toThrow('exploration_suggestion_blocked');
  });
});
