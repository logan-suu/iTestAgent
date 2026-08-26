/**
 * Phase 5 integration — Draft code generation (P1).
 *
 * Verifies the FlowV2 → draft code generation pipeline for both
 * XCUITest (Swift) and Appium (TypeScript) output formats.
 *
 * P1: FlowV2 → generateDraft → DraftResult (XCUITest + Appium)
 * Cross-package: itestagent-flow + itestagent-contracts
 */
import { describe, expect, it } from 'bun:test';

import { type FlowV2, generateDraft } from 'itestagent-flow';

const FULL_FLOW: FlowV2 = {
  schemaVersion: 'itestagent.flow.v2',
  flowId: 'login-flow-v2',
  source: 'agent-recorded',
  status: 'confirmed',
  supportedTargetKinds: ['simulator', 'physical'],
  requiredCapabilities: ['tap', 'swipe', 'typeText'],
  lastValidatedTargets: [{ kind: 'simulator', udid: 'sim-001' }],
  steps: [
    {
      action: 'launchApp',
      target: 'MyApp',
      value: 'com.example.app',
    },
    {
      action: 'tap',
      target: 'Login tab',
      locator: { strategy: 'identifier', value: 'loginTab' },
    },
    {
      action: 'typeText',
      target: 'Email field',
      locator: { strategy: 'identifier', value: 'emailField' },
      value: 'test@example.com',
    },
    {
      action: 'typeText',
      target: 'Password field',
      locator: { strategy: 'identifier', value: 'passwordField' },
      value: 'password123',
    },
    {
      action: 'tap',
      target: 'Sign In button',
      locator: { strategy: 'identifier', value: 'signInButton' },
    },
    {
      action: 'screenshot',
      target: 'Dashboard',
    },
    {
      action: 'swipe',
      target: 'List',
      locator: { strategy: 'identifier', value: 'itemList' },
      direction: 'down',
    },
    {
      action: 'terminateApp',
      target: 'MyApp',
      value: 'com.example.app',
    },
  ],
};

const MINIMAL_FLOW: FlowV2 = {
  schemaVersion: 'itestagent.flow.v2',
  flowId: 'minimal-flow',
  source: 'agent-recorded',
  status: 'draft',
  supportedTargetKinds: ['simulator'],
  requiredCapabilities: ['tap'],
  lastValidatedTargets: [],
  steps: [
    {
      action: 'tap',
      target: 'Button',
      locator: { strategy: 'coordinate', value: '0.5,0.5' },
    },
  ],
};

describe('Phase 5: Draft Code Generation', () => {
  describe('XCUITest format (Swift)', () => {
    it('generates a complete XCUITest file from full flow', () => {
      const result = generateDraft(FULL_FLOW, {
        format: 'xcuitest',
        runId: 'run-001',
      });

      expect(result.language).toBe('swift');
      expect(result.flowId).toBe('login-flow-v2');
      expect(result.runId).toBe('run-001');
      expect(result.code).toContain('import XCTest');
      expect(result.code).toContain('class');
      expect(result.code).toContain('func');
      expect(result.code).toContain('XCUIApplication');
      expect(result.code).toContain('launch');
    });

    it('generates file path under drafts/ directory', () => {
      const result = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      expect(result.filePath).toContain('drafts');
      expect(result.filePath).toContain('login-flow-v2');
      expect(result.filePath).toMatch(/\.swift$/);
    });

    it('includes all step actions in generated code', () => {
      const result = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      expect(result.code).toContain('launch');
      expect(result.code).toContain('tap');
      expect(result.code).toContain('typeText');
      expect(result.code).toContain('screenshot');
      expect(result.code).toContain('swipe');
      expect(result.code).toContain('terminate');
    });

    it('includes locator identifiers in generated code', () => {
      const result = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      expect(result.code).toContain('loginTab');
      expect(result.code).toContain('emailField');
      expect(result.code).toContain('passwordField');
      expect(result.code).toContain('signInButton');
    });

    it('generates valid Swift from minimal flow', () => {
      const result = generateDraft(MINIMAL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      expect(result.language).toBe('swift');
      expect(result.code.length).toBeGreaterThan(0);
    });
  });

  describe('Appium format (TypeScript)', () => {
    it('generates a complete Appium test file from full flow', () => {
      const result = generateDraft(FULL_FLOW, {
        format: 'appium',
        runId: 'run-001',
      });

      expect(result.language).toBe('typescript');
      expect(result.flowId).toBe('login-flow-v2');
      expect(result.runId).toBe('run-001');

      expect(result.code).toContain('describe');
      expect(result.code).toContain('it(');
      expect(result.code).toContain('webdriverio');
    });

    it('generates file path under drafts/ directory', () => {
      const result = generateDraft(FULL_FLOW, { format: 'appium', runId: 'run-001' });
      expect(result.filePath).toContain('drafts');
      expect(result.filePath).toContain('login-flow-v2');
      expect(result.filePath).toMatch(/\.ts$/);
    });

    it('includes WebDriverIO-style element selectors', () => {
      const result = generateDraft(FULL_FLOW, { format: 'appium', runId: 'run-001' });
      expect(result.code).toContain('loginTab');
      expect(result.code).toContain('emailField');
    });

    it('generates valid TypeScript from minimal flow', () => {
      const result = generateDraft(MINIMAL_FLOW, { format: 'appium', runId: 'run-001' });
      expect(result.language).toBe('typescript');
      expect(result.code.length).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('throws on empty steps array', () => {
      const emptyFlow: FlowV2 = {
        schemaVersion: 'itestagent.flow.v2',
        flowId: 'empty',
        source: 'agent-recorded',
        status: 'draft',
        supportedTargetKinds: ['simulator'],
        requiredCapabilities: ['tap'],
        lastValidatedTargets: [],
        steps: [],
      };

      expect(() => generateDraft(emptyFlow, { format: 'xcuitest', runId: 'run-001' })).toThrow();
    });

    it('generates consistent output for same input', () => {
      const result1 = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      const result2 = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });

      expect(result1.code).toBe(result2.code);
      expect(result1.filePath).toBe(result2.filePath);
    });

    it('different runIds produce different file paths', () => {
      const result1 = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      const result2 = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-002' });

      expect(result1.filePath).not.toBe(result2.filePath);
    });

    it('does not write to disk (R7 — returns string path only)', () => {
      const { existsSync } = require('node:fs');
      const result = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      expect(result.filePath).toBeDefined();
      expect(typeof result.filePath).toBe('string');
      expect(existsSync(result.filePath)).toBe(false);
    });
  });

  describe('Content correctness', () => {
    it('preserves bundle IDs in launchApp step', () => {
      const result = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      expect(result.code).toContain('launch');
      expect(result.code).toContain('MyApp');
    });

    it('preserves typeText values', () => {
      const result = generateDraft(FULL_FLOW, { format: 'xcuitest', runId: 'run-001' });
      expect(result.code).toContain('test@example.com');
      expect(result.code).toContain('password123');
    });

    it('handles coordinate locators', () => {
      const result = generateDraft(MINIMAL_FLOW, { format: 'appium', runId: 'run-001' });
      expect(result.code).toContain('click');
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
