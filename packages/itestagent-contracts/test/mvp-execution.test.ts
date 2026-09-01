/**
 * mvp-execution.test.ts — B04 contract tests for the MVP execution compiler
 * (promotion batch B04, guide §11.3 "TestPlan/target execution").
 *
 * compileMvpExecution is the contracts-layer pure function that turns a
 * canonical TestPlan into the normalized MvpExecutionInput consumed by the
 * engine target-execution lane (B14/B15). Semantics locked here:
 *
 *   - fail-closed: invalid cross-field plans throw MvpCompilationError with
 *     the typed issues from validateTestPlan (never a bare ZodError);
 *   - executionPath decision table for prefer=auto|xcuitest|device_backend,
 *     where auto uses an explicit ExecutionPlan.xcuitest.scheme as the
 *     XCUITest-presence signal at the contracts layer;
 *   - discriminated device selector passthrough.
 */
import { describe, expect, it } from 'bun:test';
import {
  MvpCompilationError,
  MvpExecutionInputSchema,
  compileMvpExecution,
} from '../src/mvp-execution.js';
import { validateTestPlan } from '../src/test-plan-validation.js';
import { makeValidTestPlan } from './test-plan.fixture.js';

describe('compileMvpExecution (happy path)', () => {
  it('compiles a valid physical plan into the normalized input', () => {
    const plan = makeValidTestPlan();
    const compiled = compileMvpExecution(plan);
    expect(compiled.runId).toBe(plan.runId);
    expect(compiled.deviceKind).toBe('physical');
    expect(compiled.executionPath).toBe('device_backend'); // auto without explicit xcuitest scheme
    expect(compiled.features).toEqual(['login', 'checkout']);
    expect(compiled.metrics).toEqual(['launch_time', 'memory_peak', 'hitches']);
  });

  it('compiles a simulator plan with its own selector discriminator', () => {
    const plan = makeValidTestPlan({
      device: { kind: 'simulator', simulator: { selector: 'booted' } },
      performance: {
        baseline: 'local_auto',
        baselineDomain: 'simulator',
        thresholdRequired: false,
      },
    });
    const compiled = compileMvpExecution(plan);
    expect(compiled.deviceKind).toBe('simulator');
    expect(compiled.deviceSelector.kind).toBe('simulator');
    if (compiled.deviceSelector.kind === 'simulator') {
      expect(compiled.deviceSelector.simulator.selector).toBe('booted');
    }
    expect(compiled.performance.baselineDomain).toBe('simulator');
  });

  it('passes safety policy through untouched (R7 decisions stay in the plan)', () => {
    const plan = makeValidTestPlan({
      safety: { defaultMode: 'deny', highRiskActions: ['store_credential'] },
    });
    expect(compileMvpExecution(plan).safety).toEqual({
      defaultMode: 'deny',
      highRiskActions: ['store_credential'],
    });
  });

  it('output validates against MvpExecutionInputSchema (self-contract)', () => {
    const compiled = compileMvpExecution(makeValidTestPlan());
    expect(MvpExecutionInputSchema.safeParse(compiled).success).toBe(true);
  });
});

describe('compileMvpExecution executionPath decision table', () => {
  it('consumes the confirmed DeviceBackend route without re-inferring it', () => {
    const plan = makeValidTestPlan({
      execution: {
        ...makeValidTestPlan().execution,
        prefer: 'device_backend',
        resolvedPath: 'device_backend',
        selectionReason: 'explicit_preference',
      },
    });
    expect(compileMvpExecution(plan).executionPath).toBe('device_backend');
  });

  it('consumes the confirmed XCUITest route', () => {
    const plan = makeValidTestPlan({
      execution: {
        ...makeValidTestPlan().execution,
        prefer: 'xcuitest',
        fallback: 'abort',
        resolvedPath: 'xcuitest',
        selectionReason: 'explicit_preference',
        xcuitest: { scheme: 'AppUITests' },
      },
    });
    expect(compileMvpExecution(plan).executionPath).toBe('xcuitest');
  });

  it('rejects a route/configuration mismatch instead of applying a fallback', () => {
    const mismatched = makeValidTestPlan({
      execution: {
        ...makeValidTestPlan().execution,
        prefer: 'auto',
        resolvedPath: 'device_backend',
        selectionReason: 'confirmed_no_xcuitest_candidate',
        xcuitest: { scheme: 'AppUITests' },
      },
    });
    expect(() => compileMvpExecution(mismatched)).toThrow(
      'device_route_with_xcuitest_configuration',
    );
  });

  it('rejects runtime fallback semantics for an auto-resolved XCUITest route', () => {
    const invalidFallback = makeValidTestPlan({
      execution: {
        ...makeValidTestPlan().execution,
        prefer: 'auto',
        fallback: 'device_backend',
        resolvedPath: 'xcuitest',
        selectionReason: 'evidence_backed_xcuitest',
        xcuitest: { scheme: 'AppUITests' },
      },
    });
    expect(() => compileMvpExecution(invalidFallback)).toThrow('xcuitest_route_requires_abort');
  });
});

describe('compileMvpExecution (fail-closed)', () => {
  it('throws MvpCompilationError carrying typed issues for a kind/selector mismatch', () => {
    const broken = makeValidTestPlan({ device: { kind: 'physical' } });
    expect(validateTestPlan(broken).length).toBeGreaterThan(0);
    try {
      compileMvpExecution(broken);
      throw new Error('expected compileMvpExecution to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MvpCompilationError);
      const mvpError = error as MvpCompilationError;
      expect(mvpError.issues.map((issue) => issue.code)).toContain('selector_kind_mismatch');
    }
  });

  it('throws for by_udid without a udid (missing field)', () => {
    const broken = makeValidTestPlan({
      device: { kind: 'physical', physical: { selector: 'by_udid' } },
    });
    try {
      compileMvpExecution(broken);
      throw new Error('expected compileMvpExecution to throw');
    } catch (error) {
      expect((error as MvpCompilationError).issues.map((issue) => issue.code)).toContain(
        'selector_missing_field',
      );
    }
  });

  it('throws for create_from_profile without runtime/deviceType identifiers', () => {
    const broken = makeValidTestPlan({
      device: { kind: 'simulator', simulator: { selector: 'create_from_profile' } },
    });
    try {
      compileMvpExecution(broken);
      throw new Error('expected compileMvpExecution to throw');
    } catch (error) {
      const codes = (error as MvpCompilationError).issues.map((issue) => issue.code);
      expect(codes).toContain('selector_missing_field');
    }
  });

  it('error message is human-readable and mentions the batch-relevant path', () => {
    const broken = makeValidTestPlan({ device: { kind: 'physical' } });
    try {
      compileMvpExecution(broken);
      throw new Error('expected compileMvpExecution to throw');
    } catch (error) {
      expect((error as MvpCompilationError).message).toContain('device');
    }
  });
});
