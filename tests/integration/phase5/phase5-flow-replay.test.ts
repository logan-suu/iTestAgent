/**
 * Phase 5 integration — Flow replay pipeline (P0).
 *
 * Verifies the end-to-end flow replay chain: FlowV2 schema →
 * FlowReplayEngine → ReplayResult. Uses a mock DeviceBackend to
 * exercise the replay orchestration without requiring real hardware.
 *
 * P0: FlowV2 → replayFlow → ReplayResult
 * Cross-package: itestagent-flow + itestagent-contracts
 */
import { describe, expect, it } from 'bun:test';

import type {
  ActionResult,
  AppInfo,
  ArtifactRef,
  BackendCapabilities,
  CrashSummary,
  DeviceBackend,
  DeviceInfo,
  HealthCheckResult,
  RecordingHandle,
  UiTreeSnapshot,
} from 'itestagent-contracts';

import {
  type FlowV2,
  type ReplayResult,
  checkTargetCompatibility,
  replayFlow,
} from 'itestagent-flow';

function makeMockBackendCapabilities(): BackendCapabilities {
  return {
    supportedTargetKinds: ['simulator', 'physical'],
    features: ['tap', 'swipe', 'typeText'],
    supportsUiTree: true,
    supportsScreenshot: true,
    supportsVideo: false,
    supportsCrashLogs: false,
    supportsLocation: false,
    supportsPush: false,
  };
}

function makePassResult(message = 'ok'): ActionResult {
  return { success: true, message };
}

function makeMockDeviceBackend(): DeviceBackend {
  return {
    name: 'MockBackend',
    capabilities: makeMockBackendCapabilities(),

    async listDevices(): Promise<DeviceInfo[]> {
      return [
        {
          udid: 'test-udid-001',
          name: 'iPhone 16 Pro',
          model: 'iPhone17,1',
          osVersion: '18.2',
          platform: 'ios',
          targetKind: 'simulator',
          runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
        },
      ];
    },

    async healthcheck(_deviceId: string): Promise<HealthCheckResult> {
      return { healthy: true, details: 'All checks passed' };
    },

    async listApps(_deviceId: string): Promise<AppInfo[]> {
      return [{ bundleId: 'com.example.app', name: 'Example App' }];
    },

    async launchApp(input): Promise<ActionResult> {
      return makePassResult(`Launched ${input.bundleId}`);
    },

    async terminateApp(input): Promise<ActionResult> {
      return makePassResult(`Terminated ${input.bundleId}`);
    },

    async getUiTree(_input): Promise<UiTreeSnapshot> {
      return {
        raw: '<App><Button name="Login"/></App>',
        format: 'xml',
        capturedAt: new Date().toISOString(),
      };
    },

    async screenshot(_input): Promise<ArtifactRef> {
      return {
        id: 'ss-mock-001',
        type: 'screenshot',
        path: 'artifacts/ss-mock-001.png',
        mimeType: 'image/png',
        redactionStatus: 'safe',
      };
    },

    async tap(_input): Promise<ActionResult> {
      return makePassResult('Tapped');
    },

    async swipe(_input): Promise<ActionResult> {
      return makePassResult('Swiped');
    },

    async typeText(_input): Promise<ActionResult> {
      return makePassResult('Typed text');
    },

    async pressButton(_input): Promise<ActionResult> {
      return makePassResult('Button pressed');
    },

    async openUrl(_input): Promise<ActionResult> {
      return makePassResult('URL opened');
    },

    async startRecording(_input): Promise<RecordingHandle> {
      return { handleId: 'rec-001', startedAt: new Date().toISOString() };
    },

    async stopRecording(_input): Promise<ArtifactRef> {
      return {
        id: 'vid-mock-001',
        type: 'video',
        path: 'artifacts/vid-mock-001.mp4',
        mimeType: 'video/mp4',
        redactionStatus: 'safe',
      };
    },

    async listCrashes(_input): Promise<CrashSummary[]> {
      return [];
    },

    async collectLogs(_input): Promise<ArtifactRef> {
      return {
        id: 'log-001',
        type: 'log',
        path: 'artifacts/log-001.log',
        redactionStatus: 'safe',
      };
    },
  };
}

const BASIC_FLOW: FlowV2 = {
  schemaVersion: 'itestagent.flow.v2',
  flowId: 'test-flow-001',
  source: 'agent-recorded',
  status: 'confirmed',
  supportedTargetKinds: ['simulator', 'physical'],
  requiredCapabilities: ['tap', 'swipe', 'typeText'],
  lastValidatedTargets: [{ kind: 'simulator', udid: 'test-udid-001' }],
  steps: [
    {
      action: 'launchApp',
      target: 'App',
      value: 'com.example.app',
    },
    {
      action: 'tap',
      target: 'Login button',
      locator: { strategy: 'identifier', value: 'loginButton' },
    },
    {
      action: 'typeText',
      target: 'Username field',
      locator: { strategy: 'identifier', value: 'usernameField' },
      value: 'testuser',
    },
    {
      action: 'typeText',
      target: 'Password field',
      locator: { strategy: 'identifier', value: 'passwordField' },
      value: 'testpass',
    },
    {
      action: 'tap',
      target: 'Submit button',
      locator: { strategy: 'identifier', value: 'submitButton' },
    },
    {
      action: 'screenshot',
      target: 'Dashboard screen',
    },
  ],
};

const FLOW_WITH_COORDINATE_LOCATOR: FlowV2 = {
  schemaVersion: 'itestagent.flow.v2',
  flowId: 'test-flow-coord',
  source: 'agent-recorded',
  status: 'confirmed',
  supportedTargetKinds: ['simulator'],
  requiredCapabilities: ['tap'],
  lastValidatedTargets: [],
  steps: [
    {
      action: 'tap',
      target: 'Center of screen',
      locator: { strategy: 'coordinate', value: '0.5,0.5' },
    },
  ],
};

describe('Phase 5: Flow Replay Pipeline', () => {
  const backend = makeMockDeviceBackend();
  const deviceId = 'test-udid-001';

  describe('checkTargetCompatibility', () => {
    it('returns ok for matching target kind', () => {
      const result = checkTargetCompatibility(BASIC_FLOW, 'simulator');
      expect(result.ok).toBe(true);
      expect(result.requested).toBe('simulator');
    });

    it('returns ok for physical on flow that supports physical', () => {
      const result = checkTargetCompatibility(BASIC_FLOW, 'physical');
      expect(result.ok).toBe(true);
    });

    it('returns not ok for unsupported target kind', () => {
      const partialFlow: FlowV2 = {
        ...BASIC_FLOW,
        supportedTargetKinds: ['physical'],
      };
      const result = checkTargetCompatibility(partialFlow, 'simulator');
      expect(result.ok).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('replayFlow basic', () => {
    it('replays a simple flow successfully', async () => {
      const result: ReplayResult = await replayFlow(BASIC_FLOW, backend, {
        deviceId,
        bundleId: 'com.example.app',
      });

      expect(result.flowId).toBe('test-flow-001');
      expect(result.deviceId).toBe(deviceId);
      expect(result.summary.total).toBe(6);

      const failedSteps = result.steps.filter((s) => s.status === 'failed');
      expect(failedSteps.length).toBe(0);
    });

    it('produces overallStatus passed when all steps pass', async () => {
      const result = await replayFlow(BASIC_FLOW, backend, { deviceId });
      expect(result.overallStatus).toBe('passed');
    });

    it('records step timestamps', async () => {
      const result = await replayFlow(BASIC_FLOW, backend, { deviceId });
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
        new Date(result.completedAt).getTime(),
      );
    });
  });

  describe('replayFlow edge cases', () => {
    it('handles coordinate-based locators', async () => {
      const result = await replayFlow(FLOW_WITH_COORDINATE_LOCATOR, backend, { deviceId });
      expect(result.steps.length).toBe(1);
      expect(result.overallStatus).toBe('passed');
    });

    it('respects collectEvidence disabled option', async () => {
      const result = await replayFlow(BASIC_FLOW, backend, {
        deviceId,
        collectEvidence: false,
      });

      for (const step of result.steps) {
        expect(step.evidence).toBeDefined();
        expect(Array.isArray(step.evidence)).toBe(true);
        expect(step.evidence.length).toBeLessThanOrEqual(1);
      }
    });

    it('handles flow with comment action gracefully', async () => {
      const commentFlow: FlowV2 = {
        schemaVersion: 'itestagent.flow.v2',
        flowId: 'flow-comment',
        source: 'agent-recorded',
        status: 'confirmed',
        supportedTargetKinds: ['simulator'],
        requiredCapabilities: ['tap'],
        lastValidatedTargets: [],
        steps: [
          {
            action: 'comment',
            target: 'Note',
            comment: 'Just a comment step',
          },
        ],
      };

      const result = await replayFlow(commentFlow, backend, { deviceId });
      expect(result.steps.length).toBe(1);
    });
  });

  describe('replayFlow targetKind isolation (ADR-011)', () => {
    it('includes targetKind in replay result', async () => {
      const result = await replayFlow(BASIC_FLOW, backend, { deviceId });
      expect(result.targetKind).toBeDefined();
    });
  });
});

// ─── B25: explain-rerun command seam ───────────────────────────────

describe('B25 explain-rerun seam', () => {
  it('exposes the explain/rerun command helpers', async () => {
    const mod = await import('../../../packages/itestagent-cli/src/commands/explain-rerun.js');
    expect(typeof mod.explainRun).toBe('function');
    expect(typeof mod.rerunFailed).toBe('function');
  });
});

// ─── B34: phase5 harness seam ──────────────────────────────────────

describe('B34 phase5 harness seam', () => {
  it('reports the phase5 integration surface as coherent', async () => {
    const mod = await import('../../../packages/itestagent-engine/src/phase5-harness.js');
    expect(mod.phase5HarnessProbe().ok).toBe(true);
  });
});
