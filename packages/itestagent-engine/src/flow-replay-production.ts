import {
  type ProductionAppiumConfig,
  createAppiumDeviceBackend,
} from 'itestagent-backends-device-appium';
import type { DeviceBackend, TargetKind } from 'itestagent-contracts';
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
import { BackendRegistry, BackendSelector } from './backend-selector.js';

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
  appium: Omit<ProductionAppiumConfig, 'udid' | 'targetKind' | 'bundleId'>;
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
    };

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
): ProductionFlowReplayResult {
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

  let assembly: ReturnType<ProductionFlowReplayDependencies['createBackend']> | undefined;
  try {
    assembly = dependencies.createBackend({
      ...input.appium,
      udid: input.deviceId,
      targetKind: input.targetKind,
      bundleId: input.bundleId,
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
      targetKind: input.targetKind,
      deviceId: input.deviceId,
      bundleId: input.bundleId,
    });
    return { success: true, replay, backend: selection.backend.name };
  } catch (error) {
    return {
      success: false,
      status: 'infra_failure',
      reasonCode: 'infra.production_replay_failed',
      reason: error instanceof Error ? error.message : String(error),
      remediation: ['Check Appium/WDA configuration and retry on the same explicit target.'],
    };
  } finally {
    await assembly?.close();
  }
}
