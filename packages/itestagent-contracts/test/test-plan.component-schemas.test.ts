/**
 * test-plan.component-schemas.test.ts — B04 component-level schema behavior
 * for the TestPlan/target-execution contracts slice (promotion batch B04,
 * guide §11.3 "TestPlan/target execution").
 *
 * Replaces the component sections of the former monolithic
 * `test-plan.test.ts` (guide §6.3: monolithic remote test deleted once the
 * replacement tests land in the same commit). Focus areas:
 *
 *   - DeviceSelector variant matrix (physical/simulator selector kinds and
 *     their per-selector fields) — schema-level acceptance only; cross-field
 *     completeness is enforced by `validateTestPlan` (test-plan-validation).
 *   - ExecutionPlan.xcuitest — the new target-explicit override (B04).
 *   - BackendPreference enum boundaries.
 *   - PerformancePlan baselineDomain isolation (ADR-011).
 *   - PermissionPolicyRef high-risk action coverage (R7).
 *   - PhysicalMvpIdentity injection semantics (guide §6.2: no baked-in
 *     machine identity; all fields optional, memory-only facts, R6/R7).
 */
import { describe, expect, it } from 'bun:test';
import { PhysicalIdentitySchema } from '../src/physical-mvp.js';
import {
  BackendPreferenceSchema,
  DeviceSelectorSchema,
  ExecutionPlanSchema,
  PerformancePlanSchema,
  PermissionPolicyRefSchema,
} from '../src/test-plan.js';

// ─── DeviceSelectorSchema ────────────────────────────────────

describe('DeviceSelectorSchema (variant matrix)', () => {
  it('accepts every physical selector kind', () => {
    expect(
      DeviceSelectorSchema.parse({ kind: 'physical', physical: { selector: 'local_connected' } })
        .kind,
    ).toBe('physical');
    expect(
      DeviceSelectorSchema.parse({
        kind: 'physical',
        physical: { selector: 'by_udid', udid: '00008101-000A2C3E' },
      }).physical?.udid,
    ).toBe('00008101-000A2C3E');
    expect(
      DeviceSelectorSchema.parse({
        kind: 'physical',
        physical: { selector: 'by_name', name: 'iPhone 14 Plus' },
      }).physical?.name,
    ).toBe('iPhone 14 Plus');
  });

  it('accepts every simulator selector kind including create_from_profile', () => {
    const parsed = DeviceSelectorSchema.parse({
      kind: 'simulator',
      simulator: {
        selector: 'create_from_profile',
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro',
      },
    });
    expect(parsed.simulator?.selector).toBe('create_from_profile');
    expect(parsed.simulator?.runtimeIdentifier).toContain('iOS-18-2');
  });

  it('accepts a kind without its sub-object at schema level (cross-field check is validateTestPlan’s job)', () => {
    // The published/runtime schema keeps kind and sub-selectors independent so
    // partially-authored plans round-trip; completeness is a validation-layer
    // concern (see mvp-execution.test.ts fail-closed cases).
    const parsed = DeviceSelectorSchema.parse({ kind: 'physical' });
    expect(parsed.physical).toBeUndefined();
  });

  it('rejects an unknown kind', () => {
    const result = DeviceSelectorSchema.safeParse({ kind: 'emulator' });
    expect(result.success).toBe(false);
  });
});

// ─── ExecutionPlanSchema (incl. new xcuitest field) ──────────

function makeMinimalExecution() {
  return {
    prefer: 'auto',
    fallback: 'device_backend',
    resolvedPath: 'device_backend',
    selectionReason: 'no_runnable_xcuitest',
    features: ['login'],
    testData: { allowAgentGeneratedData: true, askUserInTuiWhenRequired: true },
    assertion: { policy: 'user_goal_then_profile_then_agent_confirmed' },
  } as const;
}

describe('ExecutionPlanSchema.xcuitest (B04 target-explicit override)', () => {
  it('is optional — plans without it keep parsing', () => {
    const parsed = ExecutionPlanSchema.parse(makeMinimalExecution());
    expect(parsed.xcuitest).toBeUndefined();
  });

  it('accepts a required scheme plus optional configuration, test plan, and targets', () => {
    const xcuitestExecution = {
      ...makeMinimalExecution(),
      resolvedPath: 'xcuitest' as const,
      selectionReason: 'runnable_xcuitest' as const,
    };
    expect(
      ExecutionPlanSchema.parse({ ...xcuitestExecution, xcuitest: { scheme: 'AppUITests' } })
        .xcuitest?.scheme,
    ).toBe('AppUITests');
    const complete = ExecutionPlanSchema.parse({
      ...xcuitestExecution,
      xcuitest: {
        scheme: 'AppUITests',
        configuration: 'Debug',
        testPlan: 'Smoke',
        targets: ['AppUITests'],
      },
    });
    expect(complete.xcuitest).toEqual({
      scheme: 'AppUITests',
      configuration: 'Debug',
      testPlan: 'Smoke',
      targets: ['AppUITests'],
    });
  });

  it('rejects an XCUITest configuration without a scheme', () => {
    expect(
      ExecutionPlanSchema.safeParse({
        ...makeMinimalExecution(),
        xcuitest: { configuration: 'Release' },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys inside the xcuitest object (strict)', () => {
    const result = ExecutionPlanSchema.safeParse({
      ...makeMinimalExecution(),
      xcuitest: { scheme: 'AppUITests', destination: 'platform=iOS' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string scheme values', () => {
    const result = ExecutionPlanSchema.safeParse({
      ...makeMinimalExecution(),
      xcuitest: { scheme: 42 },
    });
    expect(result.success).toBe(false);
  });
});

// ─── BackendPreferenceSchema ─────────────────────────────────

describe('BackendPreferenceSchema (enum boundaries)', () => {
  it('accepts the full backend matrix from AGENTS.md §3', () => {
    const parsed = BackendPreferenceSchema.parse({
      device: ['mobile-mcp', 'appium', 'iphone-use', 'mock'],
      performance: ['xctrace-analyzer-core', 'instrumentsmcp', 'raw-xcrun'],
      build: ['xcodebuild', 'fastlane'],
      analyzer: ['xcodequery', 'xcodeproj'],
    });
    expect(parsed.device).toHaveLength(4);
    expect(parsed.analyzer).toContain('xcodeproj');
  });

  it('accepts empty preference arrays (engine falls back to BackendSelector defaults)', () => {
    const parsed = BackendPreferenceSchema.parse({ device: [] });
    expect(parsed.device).toEqual([]);
    expect(parsed.build).toBeUndefined();
  });

  it('rejects unregistered backend names', () => {
    expect(BackendPreferenceSchema.safeParse({ device: ['qa-driver'] }).success).toBe(false);
    expect(BackendPreferenceSchema.safeParse({ build: ['buck'] }).success).toBe(false);
  });
});

// ─── PerformancePlanSchema ───────────────────────────────────

describe('PerformancePlanSchema (ADR-011 baseline domain isolation)', () => {
  it('accepts local_auto with either baseline domain', () => {
    expect(
      PerformancePlanSchema.parse({
        baseline: 'local_auto',
        baselineDomain: 'physical',
        thresholdRequired: true,
      }),
    ).toBeDefined();
    expect(
      PerformancePlanSchema.parse({
        baseline: 'local_auto',
        baselineDomain: 'simulator',
        thresholdRequired: false,
      }),
    ).toBeDefined();
  });

  it('rejects unknown baselines or domains', () => {
    expect(
      PerformancePlanSchema.safeParse({
        baseline: 'remote',
        baselineDomain: 'physical',
        thresholdRequired: false,
      }).success,
    ).toBe(false);
    expect(
      PerformancePlanSchema.safeParse({
        baseline: 'local_auto',
        baselineDomain: 'emulator',
        thresholdRequired: false,
      }).success,
    ).toBe(false);
  });
});

// ─── PermissionPolicyRefSchema ───────────────────────────────

describe('PermissionPolicyRefSchema (R7 high-risk coverage)', () => {
  it('accepts the full R7 high-risk action set', () => {
    const parsed = PermissionPolicyRefSchema.parse({
      defaultMode: 'ask',
      highRiskActions: [
        'clear_data',
        'reinstall',
        'write_project',
        'store_credential',
        'update_baseline',
        'overwrite_flow',
        'generate_draft',
      ],
    });
    expect(parsed.highRiskActions).toHaveLength(7);
  });

  it('rejects modes outside allow/ask/deny and unknown actions', () => {
    expect(
      PermissionPolicyRefSchema.safeParse({ defaultMode: 'yolo', highRiskActions: [] }).success,
    ).toBe(false);
    expect(
      PermissionPolicyRefSchema.safeParse({ defaultMode: 'ask', highRiskActions: ['wipe_disk'] })
        .success,
    ).toBe(false);
  });
});

// ─── PhysicalIdentitySchema (physical-mvp) ───────────────────

describe('PhysicalIdentitySchema (injection-only identity, guide §6.2)', () => {
  it('accepts a fully injected identity', () => {
    const parsed = PhysicalIdentitySchema.parse({
      teamId: 'TEAM_ID_INJECTED',
      deviceUdid: 'UDID-INJECTED-0000',
      appBundleId: 'com.example.injected.app',
      wdaBundleId: 'com.example.injected.wda',
    });
    expect(parsed.teamId).toBe('TEAM_ID_INJECTED');
  });

  it('has no baked-in defaults — every field is optional and absent unless injected', () => {
    const parsed = PhysicalIdentitySchema.parse({});
    expect(parsed.teamId).toBeUndefined();
    expect(parsed.deviceUdid).toBeUndefined();
    expect(parsed.appBundleId).toBeUndefined();
    expect(parsed.wdaBundleId).toBeUndefined();
  });

  it('rejects unknown keys (strict — no free-form metadata smuggling)', () => {
    expect(PhysicalIdentitySchema.safeParse({ serialNumber: 'F2LX...' }).success).toBe(false);
  });
});
