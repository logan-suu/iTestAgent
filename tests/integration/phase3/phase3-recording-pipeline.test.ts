/**
 * Phase 3 integration — Recording Pipeline: InteractiveRecorder → RecordingResult → compileFlow → FlowV2 → YAML.
 *
 * Cross-package chain: itestagent-engine (InteractiveRecorder, PromptBuilder) +
 * itestagent-contracts (RecordingResult, SuggestedAction, RecordingStep) +
 * itestagent-flow (compileFlow, serializeFlowYaml, parseFlowYaml, FlowV2Schema).
 *
 * Tasks 3.13 + 3.15 verification: Full recording pipeline from agent suggestions
 * through user confirm/skip/modify to FlowV2 YAML output.
 * US-8.2 (interactive recording) + US-9.1/US-9.2 (Flow YAML format).
 */
import { describe, expect, it } from 'bun:test';
import { RecordingResultSchema, SuggestedActionSchema } from 'itestagent-contracts';
import { FlowV2Schema, compileFlow, parseFlowYaml, serializeFlowYaml } from 'itestagent-flow';

const SIM_UDID = 'F7C1CF80-9B8A-4E5C-A123-4567890ABCDE';

function makeSuggestion(
  action: 'tap' | 'swipe' | 'input' | 'screenshot' | 'wait' | 'launch',
  target: string,
  reasoning: string,
): unknown {
  return SuggestedActionSchema.parse({
    action,
    target,
    reasoning,
    confidence: 0.85,
  });
}

describe('Phase 3 Recording Pipeline', () => {
  it('RecordingResult validates with confirmed + skipped steps', () => {
    const result = {
      sessionId: 'rec-mock-001',
      featureName: 'login',
      backend: 'mock',
      device: { udid: SIM_UDID, targetKind: 'simulator' as const },
      app: { bundleId: 'com.test.app' },
      endState: 'completed' as const,
      steps: [
        {
          step: {
            stepId: 'step-1',
            backend: 'mock',
            action: 'launchApp',
            target: 'mainApp',
            input: null,
            result: { status: 'ok' },
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 500,
          },
          originalSuggestion: makeSuggestion('launch', 'com.test.app', 'start app'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 'step-2',
            backend: 'mock',
            action: 'tap',
            target: 'Login',
            input: null,
            result: { status: 'ok' },
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 150,
          },
          originalSuggestion: makeSuggestion('tap', 'Login', 'tap login button'),
          userModified: false,
          skipped: false,
        },
        {
          step: null,
          originalSuggestion: makeSuggestion('tap', 'Settings', 'tap settings'),
          userModified: false,
          skipped: true,
          skipReason: 'User skipped',
        },
        {
          step: {
            stepId: 'step-3',
            backend: 'mock',
            action: 'typeText',
            target: 'phoneField',
            input: '13800138000',
            result: { status: 'ok' },
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 200,
          },
          originalSuggestion: makeSuggestion('input', 'phoneField', 'enter phone number'),
          userModified: true,
          skipped: false,
        },
      ],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      confirmedCount: 3,
      skippedCount: 1,
      cancelled: false,
    };

    const parsed = RecordingResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.steps.length).toBe(4);
      expect(parsed.data.confirmedCount).toBe(3);
      expect(parsed.data.skippedCount).toBe(1);
    }
  });

  it('RecordingResult → compileFlow produces valid FlowV2', () => {
    const recording = RecordingResultSchema.parse({
      sessionId: 'rec-pipeline-001',
      featureName: 'login-flow',
      backend: 'appium',
      device: { udid: SIM_UDID, targetKind: 'simulator' },
      app: { bundleId: 'com.test.app' },
      endState: 'completed',
      steps: [
        {
          step: {
            stepId: 's-1',
            backend: 'appium',
            action: 'launchApp',
            target: 'mainApp',
            input: null,
            result: { status: 'ok' },
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 1200,
          },
          originalSuggestion: makeSuggestion('launch', 'com.test.app', 'launch the app under test'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 's-2',
            backend: 'appium',
            action: 'tap',
            target: 'LoginButton',
            input: null,
            result: { tapped: true },
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 100,
          },
          originalSuggestion: makeSuggestion('tap', 'LoginButton', 'enter login screen'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 's-3',
            backend: 'appium',
            action: 'typeText',
            target: 'usernameField',
            input: 'testuser',
            result: { typed: true },
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 80,
          },
          originalSuggestion: makeSuggestion('input', 'usernameField', 'fill username'),
          userModified: false,
          skipped: false,
        },
      ],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      confirmedCount: 3,
      skippedCount: 0,
      cancelled: false,
    });

    const flow = compileFlow(recording);

    expect(flow.schemaVersion).toBe('itestagent.flow.v2');
    expect(flow.source).toBe('agent-recorded');
    expect(flow.status).toBe('draft');

    const parsed = FlowV2Schema.safeParse(flow);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.steps.length).toBe(3);
      const actions = parsed.data.steps.map((s) => s.action);
      expect(actions).toEqual(['launchApp', 'tap', 'typeText']);
    }
  });

  it('RecordingResult → compileFlow filters skipped steps', () => {
    const recording = RecordingResultSchema.parse({
      sessionId: 'rec-skip-test',
      featureName: 'smoke',
      backend: 'mock',
      device: { udid: SIM_UDID, targetKind: 'simulator' },
      app: { bundleId: 'com.test.app' },
      endState: 'completed',
      steps: [
        {
          step: {
            stepId: 's-1',
            backend: 'mock',
            action: 'tap',
            target: 'Tab1',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 50,
          },
          originalSuggestion: makeSuggestion('tap', 'Tab1', 'navigate to first tab'),
          userModified: false,
          skipped: false,
        },
        {
          step: null,
          originalSuggestion: makeSuggestion('swipe', 'list', 'scroll down'),
          userModified: false,
          skipped: true,
          skipReason: 'not needed',
        },
        {
          step: {
            stepId: 's-2',
            backend: 'mock',
            action: 'tap',
            target: 'Item',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 40,
          },
          originalSuggestion: makeSuggestion('tap', 'Item', 'select item'),
          userModified: false,
          skipped: false,
        },
      ],
      startedAt: new Date().toISOString(),
      confirmedCount: 2,
      skippedCount: 1,
      cancelled: false,
    });

    const flow = compileFlow(recording);
    const parsed = FlowV2Schema.safeParse(flow);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.steps.length).toBe(2);
    }
  });

  it('RecordingResult → compileFlow → serializeFlowYaml → parseFlowYaml round-trip', () => {
    const recording = RecordingResultSchema.parse({
      sessionId: 'rec-roundtrip-001',
      featureName: 'checkout-flow',
      backend: 'appium',
      device: { udid: SIM_UDID, targetKind: 'simulator' },
      app: { bundleId: 'com.shop.app' },
      endState: 'completed',
      steps: [
        {
          step: {
            stepId: 's-1',
            backend: 'appium',
            action: 'launchApp',
            target: 'mainApp',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 1000,
          },
          originalSuggestion: makeSuggestion('launch', 'com.shop.app', 'launch the shopping app'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 's-2',
            backend: 'appium',
            action: 'tap',
            target: 'AddToCart',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 120,
          },
          originalSuggestion: makeSuggestion('tap', 'AddToCart', 'add item to cart'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 's-3',
            backend: 'appium',
            action: 'swipe',
            target: 'checkout',
            input: 'up',
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 300,
          },
          originalSuggestion: makeSuggestion('swipe', 'checkout', 'scroll to checkout section'),
          userModified: false,
          skipped: false,
        },
      ],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      confirmedCount: 3,
      skippedCount: 0,
      cancelled: false,
    });

    const flow = compileFlow(recording);
    FlowV2Schema.parse(flow);

    const yaml = serializeFlowYaml(flow);
    expect(yaml).toContain('itestagent.flow.v2');
    expect(yaml).toContain('checkout-flow');
    expect(yaml).toContain('action: launchApp');
    expect(yaml).toContain('action: tap');
    expect(yaml).toContain('action: swipe');

    const parsedBack = parseFlowYaml(yaml) as Record<string, unknown>;
    const reparsed = FlowV2Schema.parse(parsedBack);
    expect(reparsed.flowId).toBe('checkout-flow');
    expect(reparsed.steps.length).toBe(3);
  });

  it('compileFlow with cancelled recording still produces draft Flow', () => {
    const recording = RecordingResultSchema.parse({
      sessionId: 'rec-cancelled',
      featureName: 'aborted-flow',
      backend: 'mock',
      device: { udid: SIM_UDID, targetKind: 'simulator' },
      app: { bundleId: 'com.test.app' },
      endState: 'cancelled',
      steps: [
        {
          step: {
            stepId: 's-1',
            backend: 'mock',
            action: 'launchApp',
            target: 'mainApp',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 500,
          },
          originalSuggestion: makeSuggestion('launch', 'com.test.app', 'launch app'),
          userModified: false,
          skipped: false,
        },
      ],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      confirmedCount: 1,
      skippedCount: 0,
      cancelled: true,
    });

    const flow = compileFlow(recording);
    expect(flow.status).toBe('draft');
    expect(flow.notes).toContain('cancelled');

    const parsed = FlowV2Schema.safeParse(flow);
    expect(parsed.success).toBe(true);
  });

  it('RecordingResult → FlowV2 preserves modified flag in notes', () => {
    const recording = RecordingResultSchema.parse({
      sessionId: 'rec-modified',
      featureName: 'modified-flow',
      backend: 'mock',
      device: { udid: SIM_UDID, targetKind: 'simulator' },
      app: { bundleId: 'com.test.app' },
      endState: 'completed',
      steps: [
        {
          step: {
            stepId: 's-1',
            backend: 'mock',
            action: 'input',
            target: 'searchField',
            input: 'modified text',
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 50,
          },
          originalSuggestion: makeSuggestion('input', 'searchField', 'type search query'),
          userModified: true,
          skipped: false,
        },
      ],
      startedAt: new Date().toISOString(),
      confirmedCount: 1,
      skippedCount: 0,
      cancelled: false,
    });

    const flow = compileFlow(recording);

    const parsed = FlowV2Schema.safeParse(flow);
    expect(parsed.success).toBe(true);
    expect(flow.notes).toBeDefined();
    expect(flow.notes).toContain('user-modified');
  });

  it('RecordingResult with zero executable steps throws', () => {
    const recording = RecordingResultSchema.parse({
      sessionId: 'rec-empty',
      featureName: 'empty-flow',
      backend: 'mock',
      device: { udid: SIM_UDID, targetKind: 'simulator' },
      app: { bundleId: 'com.test.app' },
      endState: 'completed',
      steps: [
        {
          step: null,
          originalSuggestion: makeSuggestion('tap', 'Skip', 'skip this'),
          userModified: false,
          skipped: true,
          skipReason: 'all skipped',
        },
      ],
      startedAt: new Date().toISOString(),
      confirmedCount: 0,
      skippedCount: 1,
      cancelled: false,
    });

    expect(() => compileFlow(recording)).toThrow('no executable steps remain after filtering');
  });

  it('Action normalization covers all 6 canonical types', () => {
    const recording = RecordingResultSchema.parse({
      sessionId: 'rec-canonical',
      featureName: 'all-actions',
      backend: 'mock',
      device: { udid: SIM_UDID, targetKind: 'simulator' },
      app: { bundleId: 'com.test.app' },
      endState: 'completed',
      steps: [
        {
          step: {
            stepId: 'x-1',
            backend: 'mock',
            action: 'launchApp',
            target: 'mainApp',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 100,
          },
          originalSuggestion: makeSuggestion('launch', 'com.test.app', 'launch'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 'x-2',
            backend: 'mock',
            action: 'tap',
            target: 'Button',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 50,
          },
          originalSuggestion: makeSuggestion('tap', 'Button', 'tap'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 'x-3',
            backend: 'mock',
            action: 'typeText',
            target: 'Field',
            input: 'hello',
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 50,
          },
          originalSuggestion: makeSuggestion('input', 'Field', 'type'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 'x-4',
            backend: 'mock',
            action: 'swipe',
            target: 'List',
            input: 'up',
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 200,
          },
          originalSuggestion: makeSuggestion('swipe', 'List', 'swipe'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 'x-5',
            backend: 'mock',
            action: 'screenshot',
            target: 'screen',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 300,
          },
          originalSuggestion: makeSuggestion('screenshot', 'screen', 'capture'),
          userModified: false,
          skipped: false,
        },
        {
          step: {
            stepId: 'x-6',
            backend: 'mock',
            action: 'wait',
            target: 'settle',
            input: null,
            result: {},
            artifacts: [],
            startedAt: new Date().toISOString(),
            durationMs: 2000,
          },
          originalSuggestion: makeSuggestion('wait', 'settle', 'wait for settle'),
          userModified: false,
          skipped: false,
        },
      ],
      startedAt: new Date().toISOString(),
      confirmedCount: 6,
      skippedCount: 0,
      cancelled: false,
    });

    const flow = compileFlow(recording);
    const parsed = FlowV2Schema.parse(flow);
    expect(parsed.steps.length).toBe(6);

    const actions = parsed.steps.map((s) => s.action);
    expect(new Set(actions)).toEqual(
      new Set(['launchApp', 'tap', 'typeText', 'swipe', 'screenshot', 'wait']),
    );
  });
});
