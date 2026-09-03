/**
 * Phase 5 integration — Schema contracts + redaction cross-package (P2).
 *
 * Validates Phase 5 Zod schemas (FlowV2, FlowStepV2, LocatorV2, ValidatedTarget)
 * and cross-package redaction (redactValue from engine).
 *
 * P2: FlowV2Schema round-trip, redactValue cross-package
 * Cross-package: itestagent-flow + itestagent-engine + itestagent-contracts
 */
import { describe, expect, it } from 'bun:test';

import {
  ArtifactIndexSchema,
  FailureExplanationSchema,
  RunResultSchema,
} from 'itestagent-contracts';
import { redactValue } from 'itestagent-engine';
import {
  FlowStepV2Schema,
  type FlowV2,
  FlowV2Schema,
  LocatorV2Schema,
  ValidatedTargetSchema,
} from 'itestagent-flow';

const NOW = new Date().toISOString();

describe('Phase 5: Schema Contracts', () => {
  describe('FlowV2Schema', () => {
    it('accepts a valid complete FlowV2', () => {
      const result = FlowV2Schema.safeParse(makeValidFlowV2());
      expect(result.success).toBe(true);
    });

    it('accepts minimal FlowV2', () => {
      const result = FlowV2Schema.safeParse({
        schemaVersion: 'itestagent.flow.v2',
        flowId: 'min-flow',
        source: 'agent-recorded',
        status: 'draft',
        supportedTargetKinds: ['simulator'],
        requiredCapabilities: ['tap'],
        lastValidatedTargets: [],
        steps: [{ action: 'tap', target: 'Button' }],
      });
      expect(result.success).toBe(true);
    });

    it('rejects flow with empty flowId', () => {
      const result = FlowV2Schema.safeParse({
        ...makeValidFlowV2(),
        flowId: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects flow with no steps', () => {
      const result = FlowV2Schema.safeParse({
        ...makeValidFlowV2(),
        steps: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects flow with unsupported targetKind', () => {
      const result = FlowV2Schema.safeParse({
        ...makeValidFlowV2(),
        // biome-ignore lint/suspicious/noExplicitAny: deliberately testing invalid enum value
        supportedTargetKinds: ['android' as any],
      });
      expect(result.success).toBe(false);
    });

    it('accepts flow with notes field', () => {
      const flow = {
        ...makeValidFlowV2(),
        notes: 'This is a smoke test flow',
      };
      const result = FlowV2Schema.safeParse(flow);
      expect(result.success).toBe(true);
    });

    it('rejects flow with extra unknown fields (strict)', () => {
      const result = FlowV2Schema.safeParse({
        ...makeValidFlowV2(),
        extraField: 'should not be here',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('FlowStepV2Schema', () => {
    it('accepts tap step with identifier locator', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'tap',
        target: 'Login button',
        locator: { strategy: 'identifier', value: 'loginButton' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts coordinate locator', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'tap',
        target: 'Center',
        locator: { strategy: 'coordinate', value: '0.5,0.5' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts label locator', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'tap',
        target: 'Sign In',
        locator: { strategy: 'label', value: 'Sign In' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts xpath locator', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'tap',
        target: 'Button',
        locator: { strategy: 'xpath', value: '//XCUIElementTypeButton[@name="Login"]' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts image locator', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'tap',
        target: 'Icon',
        locator: { strategy: 'image', value: 'base64encoded...' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts typeText step with value', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'typeText',
        target: 'Input',
        value: 'hello',
      });
      expect(result.success).toBe(true);
    });

    it('rejects step with unknown action', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'flyToMoon',
        target: 'Moon',
      });
      expect(result.success).toBe(false);
    });

    it('accepts swipe step with direction', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'swipe',
        target: 'List',
        direction: 'down',
      });
      expect(result.success).toBe(true);
    });

    it('accepts screenshot step without locator', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'screenshot',
        target: 'Dashboard',
      });
      expect(result.success).toBe(true);
    });

    it('accepts launchApp step with bundleId as value', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'launchApp',
        target: 'App',
        value: 'com.example.app',
      });
      expect(result.success).toBe(true);
    });

    it('accepts terminateApp step', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'terminateApp',
        target: 'App',
        value: 'com.example.app',
      });
      expect(result.success).toBe(true);
    });

    it('accepts openUrl step', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'openUrl',
        target: 'Browser',
        value: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });

    it('accepts pressButton step', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'pressButton',
        target: 'Home',
        value: 'home',
      });
      expect(result.success).toBe(true);
    });

    it('accepts wait step with durationMs', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'wait',
        target: 'Loading',
        durationMs: 2000,
      });
      expect(result.success).toBe(true);
    });

    it('accepts assertVisible step with expectedText', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'assertVisible',
        target: 'Dashboard',
        expectedText: 'Welcome',
      });
      expect(result.success).toBe(true);
    });

    it('accepts longPress step', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'longPress',
        target: 'Item',
        locator: { strategy: 'coordinate', value: '0.5,0.5' },
        durationMs: 800,
      });
      expect(result.success).toBe(true);
    });

    it('accepts step with safetyGate', () => {
      const result = FlowStepV2Schema.safeParse({
        action: 'tap',
        target: 'Delete',
        locator: { strategy: 'identifier', value: 'deleteBtn' },
        safetyGate: 'ask',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('LocatorV2Schema', () => {
    it('accepts identifier strategy', () => {
      const result = LocatorV2Schema.safeParse({
        strategy: 'identifier',
        value: 'myButton',
      });
      expect(result.success).toBe(true);
    });

    it('accepts coordinate strategy', () => {
      const result = LocatorV2Schema.safeParse({
        strategy: 'coordinate',
        value: '0.3,0.7',
      });
      expect(result.success).toBe(true);
    });

    it('accepts xpath strategy', () => {
      const result = LocatorV2Schema.safeParse({
        strategy: 'xpath',
        value: '//XCUIElementTypeButton[@name="Login"]',
      });
      expect(result.success).toBe(true);
    });

    it('accepts label strategy', () => {
      const result = LocatorV2Schema.safeParse({
        strategy: 'label',
        value: 'Sign In',
      });
      expect(result.success).toBe(true);
    });

    it('accepts image strategy', () => {
      const result = LocatorV2Schema.safeParse({
        strategy: 'image',
        value: 'base64img',
      });
      expect(result.success).toBe(true);
    });

    it('rejects unknown locator strategy', () => {
      const result = LocatorV2Schema.safeParse({
        strategy: 'mind_reading',
        value: 'anything',
      });
      expect(result.success).toBe(false);
    });

    it('accepts locator with empty value (no min-length constraint)', () => {
      const result = LocatorV2Schema.safeParse({
        strategy: 'identifier',
        value: '',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ValidatedTargetSchema', () => {
    it('accepts simulator target', () => {
      const result = ValidatedTargetSchema.safeParse({
        kind: 'simulator',
        udid: 'sim-udid-001',
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
      });
      expect(result.success).toBe(true);
    });

    it('accepts physical target', () => {
      const result = ValidatedTargetSchema.safeParse({
        kind: 'physical',
        udid: 'phys-udid-001',
        model: 'iPhone 14 Plus',
        osVersion: '18.2.1',
      });
      expect(result.success).toBe(true);
    });

    it('accepts minimal target with only required fields', () => {
      const result = ValidatedTargetSchema.safeParse({
        kind: 'simulator',
        udid: 'sim-udid-min',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('FailureExplanationSchema (Phase 5 regression)', () => {
    it('accepts valid explanation', () => {
      const result = FailureExplanationSchema.safeParse({
        explanationType: 'product_regression',
        runId: 'run-001',
        summary: 'App crashed due to memory pressure',
        evidence: ['crashlog-001'],
        suggestedActions: ['Move image loading to background thread'],
        confidence: 'high',
      });
      expect(result.success).toBe(true);
    });

    it('accepts explanation with low confidence', () => {
      const result = FailureExplanationSchema.safeParse({
        explanationType: 'inconclusive',
        runId: 'run-001',
        summary: 'Unknown failure',
        evidence: [],
        suggestedActions: ['Re-run with additional logging enabled'],
        confidence: 'low',
      });
      expect(result.success).toBe(true);
    });

    it('rejects explanation with missing runId', () => {
      const result = FailureExplanationSchema.safeParse({
        summary: 'Failed',
        rootCause: 'Unknown',
        confidence: 'low',
        suggestions: [],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Phase 5: Cross-Package Redaction (P2)', () => {
  describe('redactValue from itestagent-engine', () => {
    it('redacts OpenAI API keys', () => {
      const input = 'Using key sk-proj-abc123def456ghijkl789 for auth';
      const result = redactValue(input);
      expect(result).not.toContain('sk-proj-');
      expect(result).toContain('[REDACTED]');
    });

    it('matches Bearer tokens with sufficient length', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abc';
      const result = redactValue(input);
      expect(result).not.toContain('Bearer');
    });

    it('redacts credential assignments', () => {
      const input = 'password = "supersecret123"';
      const result = redactValue(input);
      expect(result).toContain('[REDACTED]');
    });

    it('does not modify safe strings', () => {
      const input = 'App launched successfully on iPhone 16 Pro';
      const result = redactValue(input);
      expect(result).toBe(input);
    });

    it('handles empty string', () => {
      const result = redactValue('');
      expect(result).toBe('');
    });

    it('handles string with no secrets', () => {
      const input = '{"status": "ok", "message": "test completed"}';
      const result = redactValue(input);
      expect(result).toBe(input);
    });
  });

  describe('RunResult Schema v3 (ADR-011 / ADR-034)', () => {
    it('accepts simulator run result', () => {
      const result = RunResultSchema.safeParse({
        schemaVersion: '3.0',
        runId: 'run-sim-001',
        projectProfileRef: 'proj-001',
        status: 'passed',
        device: {
          udid: 'sim-udid',
          name: 'iPhone 16 Pro',
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
          durationMs: 100,
          startTime: NOW,
          endTime: NOW,
          targetKind: 'simulator',
          backendUsed: 'appium',
          deviceId: 'sim-udid',
        },
        environment: {
          targetKind: 'simulator',
          representativeOfPhysicalDevice: false,
          comparisonScope: 'simulator_only',
        },
        cases: [],
        metrics: {},
        artifactRefs: [],
        startedAt: NOW,
        completedAt: NOW,
      });
      expect(result.success).toBe(true);
    });

    it('accepts physical run result', () => {
      const result = RunResultSchema.safeParse({
        schemaVersion: '3.0',
        runId: 'run-phys-001',
        projectProfileRef: 'proj-001',
        status: 'failed',
        device: {
          udid: 'phys-udid',
          name: 'iPhone 14 Plus',
          model: 'iPhone14,8',
          osVersion: '18.2.1',
          targetKind: 'physical',
        },
        execution: {
          mode: 'device_backend',
          totalSteps: 1,
          completedSteps: 1,
          failedSteps: 0,
          skippedSteps: 0,
          durationMs: 100,
          startTime: NOW,
          endTime: NOW,
          targetKind: 'physical',
          backendUsed: 'appium',
          deviceId: 'phys-udid',
        },
        environment: {
          targetKind: 'physical',
          representativeOfPhysicalDevice: true,
          comparisonScope: 'physical_only',
        },
        cases: [],
        metrics: {},
        artifactRefs: [],
        startedAt: NOW,
        completedAt: NOW,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ArtifactIndex Schema', () => {
    it('accepts valid artifact index', () => {
      const result = ArtifactIndexSchema.safeParse({
        schemaVersion: '2.0',
        runId: 'run-001',
        artifacts: [
          {
            id: 'artifact-001',
            type: 'screenshot',
            path: 'artifacts/screenshot.png',
            mimeType: 'image/png',
            redactionStatus: 'safe',
          },
          {
            id: 'artifact-002',
            type: 'crashlog',
            path: 'artifacts/crash.crash',
            redactionStatus: 'raw-local-only',
          },
        ],
        collectionOutcomes: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty artifact index', () => {
      const result = ArtifactIndexSchema.safeParse({
        schemaVersion: '2.0',
        runId: 'run-001',
        artifacts: [],
        collectionOutcomes: [],
      });
      expect(result.success).toBe(true);
    });
  });
});

function makeValidFlowV2(): FlowV2 {
  return {
    schemaVersion: 'itestagent.flow.v2',
    flowId: 'test-flow-001',
    source: 'agent-recorded',
    status: 'confirmed',
    supportedTargetKinds: ['simulator', 'physical'],
    requiredCapabilities: ['tap', 'typeText'],
    lastValidatedTargets: [
      { kind: 'simulator', udid: 'sim-001' },
      { kind: 'physical', udid: 'phys-001', model: 'iPhone 14 Plus', osVersion: '18.2.1' },
    ],
    steps: [
      {
        action: 'tap',
        target: 'Login',
        locator: { strategy: 'identifier', value: 'loginButton' },
      },
    ],
  };
}

// ─── B34: phase5 harness seam ──────────────────────────────────────

describe('B34 phase5 harness seam', () => {
  it('reports the phase5 integration surface as coherent', async () => {
    const mod = await import('../../../packages/itestagent-engine/src/phase5-harness.js');
    expect(mod.phase5HarnessProbe().ok).toBe(true);
  });
});
