/**
 * Flow v2 Schema Tests — Zod schema validation for FlowV2.
 *
 * Task 3.15: G2 contract validation — FlowV2 must pass schema checks.
 */
import { describe, expect, it } from 'bun:test';
import {
  FlowStepV2Schema,
  FlowV2Schema,
  LocatorV2Schema,
  ValidatedTargetSchema,
} from '../src/schema.js';

// ─── LocatorV2 ────────────────────────────────────────────────────

describe('LocatorV2Schema', () => {
  it('validates a label locator', () => {
    const result = LocatorV2Schema.safeParse({ strategy: 'label', value: 'Login' });
    expect(result.success).toBe(true);
  });

  it('validates an identifier locator', () => {
    const result = LocatorV2Schema.safeParse({ strategy: 'identifier', value: 'login_button' });
    expect(result.success).toBe(true);
  });

  it('validates a coordinate locator', () => {
    const result = LocatorV2Schema.safeParse({ strategy: 'coordinate', value: '0.5,0.3' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown strategy', () => {
    const result = LocatorV2Schema.safeParse({ strategy: 'css', value: '.btn' });
    expect(result.success).toBe(false);
  });

  it('rejects missing value', () => {
    const result = LocatorV2Schema.safeParse({ strategy: 'label' });
    expect(result.success).toBe(false);
  });
});

// ─── ValidatedTarget ──────────────────────────────────────────────

describe('ValidatedTargetSchema', () => {
  it('validates a simulator target with full info', () => {
    const result = ValidatedTargetSchema.safeParse({
      kind: 'simulator',
      udid: 'F3BF1718-247D-4CB2-AAAF-F7738514B14D',
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
    });
    expect(result.success).toBe(true);
  });

  it('validates a physical target', () => {
    const result = ValidatedTargetSchema.safeParse({
      kind: 'physical',
      udid: '00008110-XXXXXXXXXXXXXXXX',
      model: 'iPhone 14 Plus',
      osVersion: '18.2.1',
    });
    expect(result.success).toBe(true);
  });

  it('validates minimal target (udid only)', () => {
    const result = ValidatedTargetSchema.safeParse({
      kind: 'simulator',
      udid: 'SOME-UDID',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing udid', () => {
    const result = ValidatedTargetSchema.safeParse({ kind: 'physical' });
    expect(result.success).toBe(false);
  });
});

// ─── FlowStepV2 ───────────────────────────────────────────────────

describe('FlowStepV2Schema', () => {
  it('validates a tap step with full locator', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'tap',
      target: 'Login button',
      locator: { strategy: 'label', value: 'Login' },
    });
    expect(result.success).toBe(true);
  });

  it('validates a swipe step with direction', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'swipe',
      direction: 'up',
      durationMs: 300,
    });
    expect(result.success).toBe(true);
  });

  it('validates a typeText step with valueRef', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'typeText',
      target: 'Email field',
      valueRef: 'session.secret.email',
    });
    expect(result.success).toBe(true);
  });

  it('validates a wait step', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'wait',
      durationMs: 1000,
    });
    expect(result.success).toBe(true);
  });

  it('validates a launchApp step', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'launchApp',
      target: 'com.example.app',
    });
    expect(result.success).toBe(true);
  });

  it('validates a comment step', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'comment',
      comment: '[unmapped: executeScript] target="unknown"',
    });
    expect(result.success).toBe(true);
  });

  it('validates step with safetyGate', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'launchApp',
      target: 'com.example.app',
      safetyGate: 'ask',
    });
    expect(result.success).toBe(true);
  });

  it('validates assertText step', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'assertText',
      target: 'Welcome label',
      expectedText: 'Welcome',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid action', () => {
    const result = FlowStepV2Schema.safeParse({ action: 'fly' });
    expect(result.success).toBe(false);
  });

  it('rejects negative durationMs', () => {
    const result = FlowStepV2Schema.safeParse({
      action: 'wait',
      durationMs: -500,
    });
    expect(result.success).toBe(false);
  });
});

// ─── FlowV2 ───────────────────────────────────────────────────────

const validFlowV2 = {
  schemaVersion: 'itestagent.flow.v2' as const,
  flowId: 'login-smoke',
  source: 'agent-recorded' as const,
  status: 'draft' as const,
  supportedTargetKinds: ['physical' as const],
  requiredCapabilities: ['uiTree', 'coordinateTap'],
  lastValidatedTargets: [{ kind: 'physical' as const, udid: '00008110-XXXX' }],
  steps: [
    { action: 'launchApp' as const, target: 'com.example.app' },
    {
      action: 'tap' as const,
      target: 'Login',
      locator: { strategy: 'label' as const, value: 'Login' },
    },
    { action: 'typeText' as const, target: 'Email', valueRef: 'session.secret.email' },
    { action: 'assertVisible' as const, target: 'Home screen' },
  ],
};

describe('FlowV2Schema', () => {
  it('validates a complete flow v2', () => {
    const result = FlowV2Schema.safeParse(validFlowV2);
    expect(result.success).toBe(true);
  });

  it('validates flow with notes', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, notes: 'Login smoke test flow' });
    expect(result.success).toBe(true);
  });

  it('rejects v1 schemaVersion', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, schemaVersion: 'itestagent.flow.v1' });
    expect(result.success).toBe(false);
  });

  it('rejects empty flowId', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, flowId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty supportedTargetKinds', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, supportedTargetKinds: [] });
    expect(result.success).toBe(false);
  });

  it('rejects empty requiredCapabilities', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, requiredCapabilities: [] });
    expect(result.success).toBe(false);
  });

  it('rejects empty steps array', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, steps: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid source enum', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, source: 'magic' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status enum', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, status: 'broken' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid target kind', () => {
    const result = FlowV2Schema.safeParse({
      ...validFlowV2,
      supportedTargetKinds: ['cloud'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects flow without lastValidatedTargets', () => {
    const { lastValidatedTargets: _, ...withoutTargets } = validFlowV2;
    const result = FlowV2Schema.safeParse(withoutTargets);
    expect(result.success).toBe(false);
  });

  it('rejects flow with extra properties', () => {
    const result = FlowV2Schema.safeParse({ ...validFlowV2, extraField: 'should not be here' });
    expect(result.success).toBe(false);
  });

  it('validates flow targeting both physical and simulator', () => {
    const result = FlowV2Schema.safeParse({
      ...validFlowV2,
      supportedTargetKinds: ['physical', 'simulator'],
      lastValidatedTargets: [
        { kind: 'physical' as const, udid: '00008110-XXXX' },
        { kind: 'simulator' as const, udid: 'F3BF1718-247D-4CB2-AAAF-F7738514B14D' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates simulator flow', () => {
    const result = FlowV2Schema.safeParse({
      ...validFlowV2,
      supportedTargetKinds: ['simulator'],
      lastValidatedTargets: [
        {
          kind: 'simulator',
          udid: 'F3BF1718-247D-4CB2-AAAF-F7738514B14D',
          deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
          runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
