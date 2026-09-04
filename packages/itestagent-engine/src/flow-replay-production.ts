import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ProductionAppiumConfig,
  createAppiumDeviceBackend,
} from 'itestagent-backends-device-appium';
import { type DeviceBackend, type TargetKind, isSafeRunId } from 'itestagent-contracts';
import {
  type FlowV2,
  type ReadFlowOptions,
  type ReadFlowResult,
  type ReplayOptions,
  type ReplayResult,
  checkTargetCompatibility,
  replayFlow,
  resolveFlowFile,
  safeParseFlowV2,
} from 'itestagent-flow';
import {
  BackendRegistry,
  BackendSelector,
  CANONICAL_DEVICE_CAPABILITIES,
} from './backend-selector.js';

export interface LoadedProductionFlow extends ReadFlowResult {
  flow: FlowV2;
}

export async function loadProductionFlow(
  flowId: string,
  options: ReadFlowOptions = {},
): Promise<LoadedProductionFlow> {
  const resolved = await resolveFlowFile(flowId, options);
  const parsed = safeParseFlowV2(resolved.data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Flow "${flowId}" failed schema validation: ${issues}`);
  }
  return { ...resolved, flow: parsed.data };
}

export interface ProductionFlowReplayInput {
  flow: FlowV2;
  targetKind: TargetKind;
  deviceId: string;
  bundleId?: string;
  preferredBackend?: string;
  draftConfirmed?: boolean;
  appium: Omit<ProductionAppiumConfig, 'udid' | 'targetKind' | 'bundleId' | 'artifactDirectory'>;
  replay?: Omit<ReplayOptions, 'targetKind' | 'deviceId' | 'bundleId'>;
}

export type ProductionFlowReplayResult =
  | { success: true; replay: ReplayResult; backend: string }
  | {
      success: false;
      status: 'blocked' | 'infra_failure';
      reasonCode: string;
      reason: string;
      remediation: string[];
      /** Completed replay facts retained when only owner cleanup failed. */
      replay?: ReplayResult;
      /** Selected backend retained when only owner cleanup failed. */
      backend?: string;
      /** Earlier structured failure retained when cleanup also failed. */
      primaryFailure?: {
        status: 'blocked' | 'infra_failure';
        reasonCode: string;
        reason: string;
      };
    };

type ProductionFlowReplayFailure = Extract<ProductionFlowReplayResult, { success: false }>;

export interface ProductionFlowReplayDependencies {
  createBackend(config: ProductionAppiumConfig): {
    backend: DeviceBackend;
    close(): Promise<void>;
  };
}

const DEFAULT_DEPENDENCIES: ProductionFlowReplayDependencies = {
  createBackend: (config) => {
    const assembly = createAppiumDeviceBackend(config);
    return { backend: assembly.backend, close: () => assembly.backend.closeSession() };
  },
};

function blocked(
  reasonCode: string,
  reason: string,
  remediation: string[],
): ProductionFlowReplayFailure {
  return { success: false, status: 'blocked', reasonCode, reason, remediation };
}

/** Engine-owned production composition. It never registers a mock or dry-run backend. */
export async function runProductionFlowReplay(
  input: ProductionFlowReplayInput,
  dependencies: ProductionFlowReplayDependencies = DEFAULT_DEPENDENCIES,
): Promise<ProductionFlowReplayResult> {
  if (!input.deviceId) {
    return blocked('target.device_missing', 'An explicit device identity is required.', [
      'Pass --device-id for the selected physical device or simulator.',
    ]);
  }
  if (input.flow.status === 'deprecated') {
    return blocked('flow.deprecated', 'Deprecated flows cannot be replayed.', [
      'Create or confirm a replacement Flow.',
    ]);
  }
  if (input.flow.status === 'draft' && input.draftConfirmed !== true) {
    return blocked(
      'flow.draft_confirmation_required',
      'Draft Flow replay requires confirmation for this run.',
      ['Run interactively and confirm the draft, or promote it through the canonical Flow writer.'],
    );
  }

  const compatibility = checkTargetCompatibility(input.flow, input.targetKind);
  if (!compatibility.ok) {
    return blocked('target.incompatible', compatibility.reason ?? 'Target kind is incompatible.', [
      `Choose one of: ${compatibility.supported.join(', ')}.`,
    ]);
  }
  const unknownCapabilities = input.flow.requiredCapabilities.filter(
    (capability) => !CANONICAL_DEVICE_CAPABILITIES.has(capability),
  );
  if (unknownCapabilities.length > 0) {
    return blocked(
      'blocked.capability_unsupported',
      `Flow requires unsupported capabilities: ${unknownCapabilities.join(', ')}`,
      ['Revise the Flow to use canonical capabilities before creating a backend session.'],
    );
  }

  const runId = input.replay?.runId ?? `replay-${Date.now()}-${randomUUID()}`;
  if (!isSafeRunId(runId)) {
    return blocked('flow.run_id_invalid', 'Replay runId must be a safe local identifier.', [
      'Use 1-128 letters, numbers, dots, underscores, or hyphens without path separators.',
    ]);
  }
  const evidenceDirectory =
    input.replay?.evidenceDirectory ??
    join(tmpdir(), 'itestagent', 'flow-replay', runId, 'artifacts');

  let assembly: ReturnType<ProductionFlowReplayDependencies['createBackend']> | undefined;
  let result: ProductionFlowReplayResult;
  try {
    result = await (async (): Promise<ProductionFlowReplayResult> => {
      assembly = dependencies.createBackend({
        ...input.appium,
        udid: input.deviceId,
        targetKind: input.targetKind,
        bundleId: input.bundleId,
        artifactDirectory: evidenceDirectory,
      });
      const registry = new BackendRegistry();
      registry.register('appium', assembly.backend);
      const selection = await new BackendSelector(registry).selectProduction({
        targetKind: input.targetKind,
        deviceId: input.deviceId,
        requiredCapabilities: input.flow.requiredCapabilities,
        preferredBackend: input.preferredBackend,
        signal: input.replay?.signal,
      });
      if (!selection.success || !selection.backend) {
        return {
          success: false,
          status: selection.errorCode?.startsWith('infra.') ? 'infra_failure' : 'blocked',
          reasonCode: selection.errorCode ?? 'backend.selection_failed',
          reason: selection.error ?? 'No production backend was selected.',
          remediation: selection.remediation ?? ['Verify backend configuration and retry.'],
        };
      }

      if (input.targetKind === 'physical') {
        const physical = selection.backend as DeviceBackend & {
          probePhysicalReadiness?: (
            signal?: AbortSignal,
          ) => Promise<{ ready: boolean; details?: string }>;
        };
        if (!physical.probePhysicalReadiness) {
          return blocked(
            'backend.readiness_unsupported',
            'Physical backend has no active WDA readiness probe.',
            ['Use the production Appium backend with Route B or Route C configured.'],
          );
        }
        const readiness = await physical.probePhysicalReadiness(input.replay?.signal);
        if (!readiness.ready) {
          return {
            success: false,
            status: 'infra_failure',
            reasonCode: 'infra.wda_not_ready',
            reason: readiness.details ?? 'WDA readiness probe failed.',
            remediation: ['Repair the selected WDA route and retry without changing target kind.'],
          };
        }
      } else {
        const snapshot = await selection.backend.getUiTree(
          { deviceId: input.deviceId },
          input.replay?.signal,
        );
        if (!snapshot.raw) {
          return {
            success: false,
            status: 'infra_failure',
            reasonCode: 'infra.appium_session_not_ready',
            reason: 'Simulator Appium session readiness returned an empty UI tree.',
            remediation: ['Verify the Appium server, booted simulator, and installed application.'],
          };
        }
      }

      const replay = await replayFlow(input.flow, selection.backend, {
        ...input.replay,
        runId,
        evidenceDirectory,
        targetKind: input.targetKind,
        deviceId: input.deviceId,
        bundleId: input.bundleId,
      });
      return { success: true, replay, backend: selection.backend.name };
    })();
  } catch (error) {
    result = {
      success: false,
      status: 'infra_failure',
      reasonCode: 'infra.production_replay_failed',
      reason: error instanceof Error ? error.message : String(error),
      remediation: ['Check Appium/WDA configuration and retry on the same explicit target.'],
    };
  }

  try {
    await assembly?.close();
  } catch (error) {
    return {
      success: false,
      status: 'infra_failure',
      reasonCode: 'infra.backend_cleanup_failed',
      reason: error instanceof Error ? error.message : String(error),
      remediation: [
        'Inspect Appium/WDA owner processes, clean up only the exact owned session, and retry.',
      ],
      replay: result.success ? result.replay : undefined,
      backend: result.success ? result.backend : undefined,
      primaryFailure: result.success
        ? undefined
        : {
            status: result.status,
            reasonCode: result.reasonCode,
            reason: result.reason,
          },
    };
  }

  return result;
}
