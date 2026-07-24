import { describe, expect, it } from 'bun:test';
import {
  AppSourceSchema,
  ArtifactPolicySchema,
  BackendPreferenceSchema,
  DeviceSelectorSchema,
  ExecutionPlanSchema,
  PerformancePlanSchema,
  PermissionPolicyRefSchema,
  TargetSchema,
  TestPlanSchema,
  parseTestPlan,
  safeParseTestPlan,
} from '../src/test-plan.js';

import type { TestPlan } from '../src/test-plan.js';

// ─── Reusable valid test plan fixture ────────────────────────

function makeValidTestPlan(overrides: Partial<TestPlan> = {}): TestPlan {
  return {
    schemaVersion: 'itestagent.test-plan.v2',
    runId: 'run_20260720_001',
    projectProfileRef: '~/.itestagent/projects/abc123/project-profile.json',
    target: { type: 'current_workspace' },
    device: {
      kind: 'physical',
      physical: { selector: 'local_connected' },
    },
    appSource: { strategy: 'auto_from_workspace' },
    backendPreference: {
      device: ['appium', 'mobile-mcp', 'mock'],
      performance: ['xctrace-analyzer-core', 'raw-xcrun'],
    },
    execution: {
      prefer: 'auto',
      fallback: 'device_backend',
      features: ['login', 'checkout'],
      testData: {
        allowAgentGeneratedData: true,
        askUserInTuiWhenRequired: true,
      },
      assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
      metrics: ['launch_time', 'memory_peak', 'hitches'],
    },
    artifacts: {
      collect: ['screenshot', 'video', 'crashlog'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    },
    performance: {
      baseline: 'local_auto',
      baselineDomain: 'physical',
      thresholdRequired: false,
    },
    safety: {
      defaultMode: 'ask',
      highRiskActions: ['clear_data', 'reinstall', 'store_credential'],
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe('DeviceSelectorSchema', () => {
  it('accepts physical device with local_connected', () => {
    const result = DeviceSelectorSchema.parse({
      kind: 'physical',
      physical: { selector: 'local_connected' },
    });
    expect(result.kind).toBe('physical');
    expect(result.physical?.selector).toBe('local_connected');
  });

  it('accepts simulator device with booted selector', () => {
    const result = DeviceSelectorSchema.parse({
      kind: 'simulator',
      simulator: { selector: 'booted' },
    });
    expect(result.kind).toBe('simulator');
  });

  it('accepts simulator with runtime and device type identifiers', () => {
    const result = DeviceSelectorSchema.parse({
      kind: 'simulator',
      simulator: {
        selector: 'by_name',
        name: 'iPhone 16 Pro',
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
      },
    });
    expect(result.simulator?.runtimeIdentifier).toContain('iOS-18-2');
  });

  it('rejects missing kind field (ADR-011 requirement)', () => {
    expect(() =>
      DeviceSelectorSchema.parse({
        physical: { selector: 'local_connected' },
      }),
    ).toThrow();
  });

  it('rejects invalid kind value', () => {
    expect(() =>
      DeviceSelectorSchema.parse({
        kind: 'android',
        physical: { selector: 'local_connected' },
      }),
    ).toThrow();
  });
});

describe('TargetSchema', () => {
  it('accepts current_workspace', () => {
    expect(TargetSchema.parse({ type: 'current_workspace' }).type).toBe('current_workspace');
  });

  it('rejects unknown type', () => {
    expect(() => TargetSchema.parse({ type: 'remote_device' })).toThrow();
  });
});

describe('AppSourceSchema', () => {
  it('accepts auto_from_workspace', () => {
    expect(AppSourceSchema.parse({ strategy: 'auto_from_workspace' }).strategy).toBe(
      'auto_from_workspace',
    );
  });
});

describe('BackendPreferenceSchema', () => {
  it('accepts all four backend categories', () => {
    const result = BackendPreferenceSchema.parse({
      device: ['appium', 'mock'],
      performance: ['xctrace-analyzer-core'],
      build: ['xcodebuild'],
      analyzer: ['xcodeproj'],
    });
    expect(result.device).toEqual(['appium', 'mock']);
    expect(result.build).toEqual(['xcodebuild']);
  });

  it('accepts empty object (all optional)', () => {
    expect(BackendPreferenceSchema.parse({})).toEqual({});
  });

  it('rejects invalid backend name', () => {
    expect(() => BackendPreferenceSchema.parse({ device: ['unknown-backend'] })).toThrow();
  });
});

describe('ExecutionPlanSchema', () => {
  it('accepts valid execution plan with all fields', () => {
    const result = ExecutionPlanSchema.parse({
      prefer: 'auto',
      fallback: 'device_backend',
      features: ['login'],
      flows: ['flow-login-smoke'],
      testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: false },
      assertion: { policy: 'explore_only' },
      metrics: ['launch_time', 'crash'],
    });
    expect(result.features).toEqual(['login']);
    expect(result.metrics).toContain('launch_time');
  });

  it('accepts minimal execution plan (no optional fields)', () => {
    const result = ExecutionPlanSchema.parse({
      prefer: 'device_backend',
      fallback: 'abort',
      features: [],
      testData: { allowAgentGeneratedData: false, askUserInTuiWhenRequired: true },
      assertion: { policy: 'explore_only' },
    });
    expect(result.flows).toBeUndefined();
    expect(result.metrics).toBeUndefined();
  });

  it('rejects missing required testData', () => {
    expect(() =>
      ExecutionPlanSchema.parse({
        prefer: 'auto',
        fallback: 'device_backend',
        features: [],
        assertion: { policy: 'explore_only' },
      }),
    ).toThrow();
  });
});

describe('ArtifactPolicySchema', () => {
  it('accepts valid artifact policy', () => {
    const result = ArtifactPolicySchema.parse({
      collect: ['screenshot', 'video', 'uitree'],
      report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
    });
    expect(result.collect).toHaveLength(3);
  });

  it('rejects unknown artifact type', () => {
    expect(() =>
      ArtifactPolicySchema.parse({
        collect: ['screenshot', 'html_report'],
        report: { outputs: ['summary_md'] },
      }),
    ).toThrow();
  });
});

describe('PerformancePlanSchema', () => {
  it('accepts performance plan with baselineDomain (ADR-011)', () => {
    const result = PerformancePlanSchema.parse({
      baseline: 'local_auto',
      baselineDomain: 'simulator',
      thresholdRequired: true,
    });
    expect(result.baselineDomain).toBe('simulator');
  });

  it('rejects missing baselineDomain (ADR-011 requirement)', () => {
    expect(() =>
      PerformancePlanSchema.parse({
        baseline: 'local_auto',
        thresholdRequired: false,
      }),
    ).toThrow();
  });
});

describe('PermissionPolicyRefSchema', () => {
  it('accepts ask default with high-risk actions', () => {
    const result = PermissionPolicyRefSchema.parse({
      defaultMode: 'ask',
      highRiskActions: ['clear_data', 'reinstall'],
    });
    expect(result.defaultMode).toBe('ask');
  });

  it('accepts allow default with empty high-risk list', () => {
    const result = PermissionPolicyRefSchema.parse({
      defaultMode: 'allow',
      highRiskActions: [],
    });
    expect(result.highRiskActions).toEqual([]);
  });
});

describe('TestPlanSchema (root)', () => {
  it('parses a complete valid TestPlan', () => {
    const plan = makeValidTestPlan();
    const result = TestPlanSchema.parse(plan);
    expect(result.schemaVersion).toBe('itestagent.test-plan.v2');
    expect(result.runId).toBe('run_20260720_001');
    expect(result.device.kind).toBe('physical');
    expect(result.execution.features).toEqual(['login', 'checkout']);
    expect(result.performance.baselineDomain).toBe('physical');
  });

  it('parses TestPlan with simulator device configuration', () => {
    const plan = makeValidTestPlan({
      device: {
        kind: 'simulator',
        simulator: { selector: 'booted' },
      },
      performance: {
        baseline: 'local_auto',
        baselineDomain: 'simulator',
        thresholdRequired: false,
      },
    });
    const result = TestPlanSchema.parse(plan);
    expect(result.device.kind).toBe('simulator');
    expect(result.device.simulator?.selector).toBe('booted');
  });

  it('rejects unknown top-level fields (strict mode)', () => {
    const plan: Record<string, unknown> = {
      ...makeValidTestPlan(),
      extraField: 'should not be here',
    };
    expect(() => TestPlanSchema.parse(plan)).toThrow();
  });

  it('rejects missing required top-level fields', () => {
    expect(() =>
      TestPlanSchema.parse({
        schemaVersion: 'itestagent.test-plan.v2',
        runId: 'run_001',
        // missing projectProfileRef, target, device, etc.
      }),
    ).toThrow();
  });

  it('rejects wrong schemaVersion', () => {
    const plan = makeValidTestPlan({ schemaVersion: 'wrong.version' as 'itestagent.test-plan.v2' });
    expect(() => TestPlanSchema.parse(plan)).toThrow();
  });

  it('rejects empty runId', () => {
    const plan = makeValidTestPlan({ runId: '' });
    expect(() => TestPlanSchema.parse(plan)).toThrow();
  });
});

describe('parseTestPlan', () => {
  it('returns parsed TestPlan on valid input', () => {
    const plan = makeValidTestPlan();
    expect(parseTestPlan(plan).runId).toBe('run_20260720_001');
  });

  it('throws on invalid input', () => {
    expect(() => parseTestPlan({})).toThrow();
  });
});

describe('safeParseTestPlan', () => {
  it('returns success on valid input', () => {
    const plan = makeValidTestPlan();
    const result = safeParseTestPlan(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runId).toBe('run_20260720_001');
    }
  });

  it('returns failure on invalid input', () => {
    const result = safeParseTestPlan({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});
