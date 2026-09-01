import type { MvpDeviceSelector, MvpExecutionInput } from '../src/mvp-execution.js';
/**
 * test-plan.fixture.ts — shared TestPlan/MVP-execution fixtures for the B04
 * contracts tests (promotion batch B04, guide §11.3 "TestPlan/target
 * execution").
 *
 * Extracted from the former monolithic `test-plan.test.ts` so the split test
 * files (component-schemas / root / mvp-execution / mvp-consistency) share
 * one canonical valid-plan builder instead of duplicating object literals.
 * Not a `.test.ts` file — never executed directly by the batch runner.
 */
import type { ExecutionPlan, TestPlan } from '../src/test-plan.js';

/**
 * Narrows a parsed plan's device selector into the compiled discriminated
 * union shape. Throws on fixture-authoring mistakes (incomplete selector) so
 * mapping tests fail loudly instead of asserting undefineds.
 */
function selectorOf(plan: TestPlan): MvpDeviceSelector {
  if (plan.device.kind === 'physical' && plan.device.physical) {
    return { kind: 'physical', physical: plan.device.physical };
  }
  if (plan.device.kind === 'simulator' && plan.device.simulator) {
    return { kind: 'simulator', simulator: plan.device.simulator };
  }
  throw new Error('fixture plan must carry a complete device selector');
}

// ─── Valid TestPlan builder ──────────────────────────────────

/**
 * Builds a fully valid physical-target TestPlan. Every field is overridable
 * so individual tests only spell out the delta under examination.
 */
export function makeValidTestPlan(overrides: Partial<TestPlan> = {}): TestPlan {
  return {
    schemaVersion: 'itestagent.test-plan.v3',
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
      resolvedPath: 'device_backend',
      selectionReason: 'no_runnable_xcuitest',
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

// ─── ExecutionPlan helpers ───────────────────────────────────

/**
 * Returns the fixture's default execution plan with an explicit XCUITest
 * target attached (B04: `ExecutionPlan.xcuitest`, target-explicit override).
 */
export function makeXcuitestExecution(
  overrides: Partial<NonNullable<ExecutionPlan['xcuitest']>> = {},
): NonNullable<ExecutionPlan['xcuitest']> {
  return { scheme: 'MyAppUITests', ...overrides };
}

// ─── Physical MVP contract fixtures ─────────────────────────

/**
 * A fully-injected physical identity (guide §6.2 "physical MVP/Route C":
 * team/device/app identity is injected, never baked in; authorization /
 * fingerprint / signing facts stay memory-only per R6/R7).
 */
export function makeInjectedPhysicalIdentity() {
  return {
    teamId: 'TEAM_ID_INJECTED',
    deviceUdid: 'UDID-INJECTED-0000',
    appBundleId: 'com.example.injected.app',
    wdaBundleId: 'com.example.injected.wda',
  };
}

// ─── Compiled MVP input expectation ──────────────────────────

/**
 * Derives the expected {@link MvpExecutionInput} shape for a given plan so
 * mapping tests assert field-for-field correspondence instead of rebuilding
 * literals by hand.
 */
export function expectMvpInputFrom(plan: TestPlan): MvpExecutionInput {
  return {
    runId: plan.runId,
    projectProfileRef: plan.projectProfileRef,
    deviceKind: plan.device.kind,
    deviceSelector: selectorOf(plan),
    executionPath: plan.execution.resolvedPath,
    features: plan.execution.features,
    flows: plan.execution.flows,
    metrics: plan.execution.metrics,
    assertion: plan.execution.assertion,
    testData: plan.execution.testData,
    artifacts: plan.artifacts,
    performance: plan.performance,
    safety: plan.safety,
    xcuitest: plan.execution.xcuitest,
  };
}
