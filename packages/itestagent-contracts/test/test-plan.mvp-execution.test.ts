/**
 * test-plan.mvp-execution.test.ts — B04 TestPlan ↔ MVP execution mapping
 * tests (promotion batch B04, guide §11.3 "TestPlan/target execution").
 *
 * Whereas mvp-execution.test.ts locks compiler semantics in isolation, this
 * file locks the field-for-field correspondence between a canonical TestPlan
 * and its compiled MvpExecutionInput using the shared fixture builder —
 * the "TestPlan is the single source of truth for S3→S9" guarantee
 * (Data Flow Specification §6).
 */
import { describe, expect, it } from 'bun:test';
import { compileMvpExecution } from '../src/mvp-execution.js';
import { expectMvpInputFrom, makeValidTestPlan } from './test-plan.fixture.js';

describe('TestPlan → MvpExecutionInput field mapping', () => {
  it('maps every contract section of the physical fixture plan', () => {
    const plan = makeValidTestPlan();
    const compiled = compileMvpExecution(plan);
    expect(compiled).toEqual(expectMvpInputFrom(plan));
  });

  it('maps every contract section of the simulator fixture plan', () => {
    const plan = makeValidTestPlan({
      device: { kind: 'simulator', simulator: { selector: 'booted' } },
      performance: { baseline: 'local_auto', baselineDomain: 'simulator', thresholdRequired: true },
    });
    const compiled = compileMvpExecution(plan);
    expect(compiled).toEqual(expectMvpInputFrom(plan));
  });

  it('keeps flows, artifacts, assertion and testData verbatim', () => {
    const plan = makeValidTestPlan({
      execution: {
        ...makeValidTestPlan().execution,
        flows: ['flow_login_smoke'],
        assertion: { policy: 'explore_only' },
      },
      artifacts: {
        collect: ['screenshot', 'uitree', 'xcresult'],
        report: { outputs: ['summary_md', 'result_json', 'artifact_index_json'] },
      },
    });
    const compiled = compileMvpExecution(plan);
    expect(compiled.flows).toEqual(['flow_login_smoke']);
    expect(compiled.assertion).toEqual({ policy: 'explore_only' });
    expect(compiled.artifacts.collect).toContain('uitree');
  });

  it('carries the explicit xcuitest target into the compiled input (B04)', () => {
    const plan = makeValidTestPlan({
      execution: {
        ...makeValidTestPlan().execution,
        prefer: 'auto',
        fallback: 'abort',
        resolvedPath: 'xcuitest',
        selectionReason: 'runnable_xcuitest',
        xcuitest: { scheme: 'MyAppUITests', configuration: 'Debug' },
      },
    });
    const compiled = compileMvpExecution(plan);
    expect(compiled.xcuitest).toEqual({ scheme: 'MyAppUITests', configuration: 'Debug' });
    expect(compiled.executionPath).toBe('xcuitest');
  });

  it('drops nothing when metrics are absent (explore plans stay explore, R5)', () => {
    const base = makeValidTestPlan();
    const plan = makeValidTestPlan({
      execution: { ...base.execution, metrics: undefined, assertion: { policy: 'explore_only' } },
    });
    const compiled = compileMvpExecution(plan);
    expect(compiled.metrics).toBeUndefined();
    expect(compiled).toEqual(expectMvpInputFrom(plan));
  });
});
