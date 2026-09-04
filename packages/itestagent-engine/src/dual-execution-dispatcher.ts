import type { BackendCleanupOutcome, BuildDestination, TestPlan } from 'itestagent-contracts';
import type { XcunitFlowInput, XcunitFlowResult } from './test-flow/run-xcunit-flow.js';

export interface XcuitestReadinessResult {
  ready: boolean;
  reason?: string;
}

export interface DeviceBackendDispatchInput {
  plan: TestPlan;
  workspace: string;
  destination: BuildDestination;
  signal?: AbortSignal;
}

export interface ConfirmedExecutionDispatchInput extends DeviceBackendDispatchInput {
  confirmed: boolean;
  resultBundlePath: string;
}

export type ConfirmedExecutionDispatchResult =
  | {
      status: 'completed' | 'failed' | 'cancelled';
      path: 'xcuitest';
      result?: XcunitFlowResult;
      error?: string;
      cleanupOutcome?: BackendCleanupOutcome;
      fallbackHistory: [];
    }
  | {
      status: 'completed' | 'failed' | 'cancelled';
      path: 'device_backend';
      result?: unknown;
      error?: string;
      cleanupOutcome?: BackendCleanupOutcome;
      fallbackHistory: [];
    }
  | {
      status: 'blocked';
      path: 'xcuitest' | 'device_backend';
      error: string;
      cleanupOutcome?: BackendCleanupOutcome;
      fallbackHistory: [];
    };

export interface DualExecutionDispatcherDeps {
  runXcuitest(input: XcunitFlowInput): Promise<XcunitFlowResult>;
  runDeviceBackend(input: DeviceBackendDispatchInput): Promise<unknown>;
  revalidateXcuitest(input: {
    plan: TestPlan;
    workspace: string;
    destination: BuildDestination;
    signal?: AbortSignal;
  }): Promise<XcuitestReadinessResult>;
}

/** Carries a completed DeviceBackend result when teardown makes the backend terminal. */
export class DeviceBackendCleanupError extends Error {
  constructor(
    message: string,
    readonly partialResult: unknown,
    readonly cleanupOutcome: BackendCleanupOutcome,
  ) {
    super(message);
    this.name = 'DeviceBackendCleanupError';
  }
}

/**
 * Dispatch a confirmed v3 TestPlan to exactly one semantic route.
 * Runtime failures are returned on that route and never trigger cross-route
 * fallback (US-7.1 AC6 / US-8.1 AC5 / ADR-029).
 */
export function createDualExecutionDispatcher(deps: DualExecutionDispatcherDeps): {
  dispatch(input: ConfirmedExecutionDispatchInput): Promise<ConfirmedExecutionDispatchResult>;
} {
  return {
    async dispatch(input) {
      const path = input.plan.execution.resolvedPath;
      if (!input.confirmed) {
        return {
          status: 'blocked',
          path,
          error: 'plan_confirmation_required: execution requires a confirmed TestPlan',
          fallbackHistory: [],
        };
      }
      if (input.destination.targetKind !== input.plan.device.kind) {
        return {
          status: 'blocked',
          path,
          error: 'destination_changed: destination targetKind differs from the confirmed TestPlan',
          fallbackHistory: [],
        };
      }

      if (path === 'xcuitest') {
        const selected = input.plan.execution.xcuitest;
        if (!selected) {
          return {
            status: 'blocked',
            path,
            error: 'xcuitest_configuration_missing: confirmed route has no XCUITest configuration',
            fallbackHistory: [],
          };
        }
        let readiness: { ready: boolean; reason?: string };
        try {
          readiness = await deps.revalidateXcuitest({
            plan: input.plan,
            workspace: input.workspace,
            destination: input.destination,
            ...(input.signal ? { signal: input.signal } : {}),
          });
        } catch (error) {
          return {
            status: input.signal?.aborted ? 'cancelled' : 'blocked',
            path,
            error: error instanceof Error ? error.message : String(error),
            fallbackHistory: [],
          };
        }
        if (!readiness.ready) {
          return {
            status: 'blocked',
            path,
            error: readiness.reason ?? 'xcuitest_configuration_changed',
            fallbackHistory: [],
          };
        }
        try {
          const result = await deps.runXcuitest({
            projectRoot: input.workspace,
            scheme: selected.scheme,
            testPlan: selected.testPlan,
            allowProvisioningUpdates: input.destination.targetKind === 'physical',
            only: input.plan.rerun?.selectedCaseIds ?? selected.targets,
            destination: input.destination,
            resultBundlePath: input.resultBundlePath,
            signal: input.signal,
          });
          return {
            status: input.signal?.aborted
              ? 'cancelled'
              : result.exitCode === 0 && result.parsed !== null && !result.parseError
                ? 'completed'
                : 'failed',
            path,
            result,
            fallbackHistory: [],
          };
        } catch (error) {
          return {
            status: input.signal?.aborted ? 'cancelled' : 'failed',
            path,
            error: error instanceof Error ? error.message : String(error),
            fallbackHistory: [],
          };
        }
      }

      try {
        return {
          status: 'completed',
          path,
          result: await deps.runDeviceBackend({
            plan: input.plan,
            workspace: input.workspace,
            destination: input.destination,
            signal: input.signal,
          }),
          fallbackHistory: [],
        };
      } catch (error) {
        return {
          status: input.signal?.aborted ? 'cancelled' : 'failed',
          path,
          ...(error instanceof DeviceBackendCleanupError ? { result: error.partialResult } : {}),
          ...(error instanceof DeviceBackendCleanupError
            ? { cleanupOutcome: error.cleanupOutcome }
            : {}),
          error: error instanceof Error ? error.message : String(error),
          fallbackHistory: [],
        };
      }
    },
  };
}
