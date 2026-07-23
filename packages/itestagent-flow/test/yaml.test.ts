/**
 * Flow YAML Serializer Tests — FlowV2 → YAML string round-trip.
 *
 * Task 3.15: YAML serialization and parsing.
 */
import { describe, expect, it } from 'bun:test';
import type { FlowV2 } from '../src/schema.js';
import { parseFlowYaml, serializeFlowYaml } from '../src/yaml.js';

const sampleFlow: FlowV2 = {
  schemaVersion: 'itestagent.flow.v2',
  flowId: 'login-smoke',
  source: 'agent-recorded',
  status: 'draft',
  supportedTargetKinds: ['physical'],
  requiredCapabilities: ['uiTree', 'coordinateTap', 'screenshot'],
  lastValidatedTargets: [
    { kind: 'physical', udid: '00008110-XXXX', model: 'iPhone 14 Plus', osVersion: '18.2.1' },
  ],
  steps: [
    { action: 'launchApp', target: 'com.example.app' },
    { action: 'tap', target: 'Login', locator: { strategy: 'label', value: 'Login' } },
    { action: 'typeText', target: 'Email field', valueRef: 'session.secret.email' },
    { action: 'wait', durationMs: 500 },
    { action: 'assertVisible', target: 'Home screen' },
  ],
  notes: 'Compiled from recording rec-abc123. Backend: appium.',
};

describe('serializeFlowYaml', () => {
  it('produces valid YAML string', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(typeof yaml).toBe('string');
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('starts with header comment', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml.startsWith('# iTestAgent Flow v2')).toBe(true);
  });

  it('includes schemaVersion in output', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml).toContain('schemaVersion: itestagent.flow.v2');
  });

  it('includes flowId in output', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml).toContain('flowId: login-smoke');
  });

  it('includes steps in output', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml).toContain('action: launchApp');
    expect(yaml).toContain('action: tap');
    expect(yaml).toContain('action: typeText');
  });

  it('includes locator in step', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml).toContain('strategy: label');
    expect(yaml).toContain('value: Login');
  });

  it('includes valueRef', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml).toContain('valueRef: session.secret.email');
  });

  it('includes supportedTargetKinds', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml).toContain('supportedTargetKinds');
    expect(yaml).toContain('physical');
  });

  it('includes lastValidatedTargets with full device info', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml).toContain('kind: physical');
    expect(yaml).toContain('udid: 00008110-XXXX');
    expect(yaml).toContain('model: iPhone 14 Plus');
    expect(yaml).toContain('osVersion: 18.2.1');
  });

  it('omits undefined fields from steps', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    // The launchApp step has no locator, direction, etc.
    // Those keys should not appear in the YAML for that step
    const launchLine = yaml.split('\n').findIndex((l) => l.includes('action: launchApp'));
    const nextActionLine = yaml
      .split('\n')
      .findIndex((l, i) => i > launchLine && l.includes('action:'));
    const launchBlock = yaml.split('\n').slice(launchLine, nextActionLine);
    // launchApp step should not have a locator or direction key
    const launchBlockStr = launchBlock.join('\n');
    expect(launchBlockStr).not.toContain('locator:');
    expect(launchBlockStr).not.toContain('direction:');
  });

  it('includes notes when present', () => {
    const yaml = serializeFlowYaml(sampleFlow);
    expect(yaml).toContain('notes:');
  });

  it('round-trips through parse → validate', () => {
    const { safeParseFlowV2 } = require('../src/schema.js');
    const yaml = serializeFlowYaml(sampleFlow);

    // Strip header comments for parsing
    const yamlOnly = yaml
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#') || l.trimStart() === '#')
      .join('\n');

    const parsed = parseFlowYaml(yamlOnly);
    const result = safeParseFlowV2(parsed);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flowId).toBe('login-smoke');
      expect(result.data.steps.length).toBe(5);
      expect(result.data.supportedTargetKinds).toEqual(['physical']);
    }
  });

  // ─── Simulator flow ────────────────────────────────────────────

  it('serializes simulator flow with full device info', () => {
    const simFlow: FlowV2 = {
      ...sampleFlow,
      supportedTargetKinds: ['simulator'],
      lastValidatedTargets: [
        {
          kind: 'simulator',
          udid: 'F3BF1718-247D-4CB2-AAAF-F7738514B14D',
          deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro',
          runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
        },
      ],
    };
    const yaml = serializeFlowYaml(simFlow);
    expect(yaml).toContain('deviceTypeIdentifier:');
    expect(yaml).toContain('runtimeIdentifier:');
  });

  // ─── Dual-target flow ──────────────────────────────────────────

  it('serializes dual-target flow', () => {
    const dualFlow: FlowV2 = {
      ...sampleFlow,
      supportedTargetKinds: ['physical', 'simulator'],
      lastValidatedTargets: [
        { kind: 'physical', udid: '00008110-XXXX' },
        { kind: 'simulator', udid: 'F3BF1718-XXXX' },
      ],
    };
    const yaml = serializeFlowYaml(dualFlow);
    expect(yaml).toContain('physical');
    expect(yaml).toContain('simulator');
  });
});
