import type { BuildDestination, TestPlan } from 'itestagent-contracts';
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
      status: 'completed' | 'failed';
      path: 'xcuitest';
      result?: XcunitFlowResult;
      error?: string;
      fallbackHistory: [];
    }
  | {
      status: 'completed' | 'failed';
      path: 'device_backend';
      result?: unknown;
      error?: string;
      fallbackHistory: [];
    }
  | {
      status: 'blocked';
      path: 'xcuitest' | 'device_backend';
      error: string;
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
        const readiness = await deps.revalidateXcuitest({
          plan: input.plan,
          workspace: input.workspace,
          destination: input.destination,
          signal: input.signal,
        });
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
            only: selected.targets,
            destination: input.destination,
            resultBundlePath: input.resultBundlePath,
          });
          return {
            status:
              result.exitCode === 0 && result.parsed !== null && !result.parseError
                ? 'completed'
                : 'failed',
            path,
            result,
            fallbackHistory: [],
          };
        } catch (error) {
          return {
            status: 'failed',
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
          status: 'failed',
          path,
          error: error instanceof Error ? error.message : String(error),
          fallbackHistory: [],
        };
      }
    },
  };
}
