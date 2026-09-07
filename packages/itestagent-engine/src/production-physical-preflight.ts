import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectFile } from 'itestagent-backends-analyzer-xcodeproj';
import {
  type XcodebuildProcessRunner,
  buildForPhysical,
  createDevicectlOps,
  diagnoseSigningError,
  normalizePhysicalAppArtifact,
  resolveAppSource,
} from 'itestagent-backends-build-xcodebuild';
import type {
  DeviceBackend,
  DeviceInfo,
  PhysicalAppArtifact,
  PhysicalPreflightResult,
  PhysicalRoute,
  TestPlan,
  WdaReadinessProbe,
} from 'itestagent-contracts';
import { createPhysicalPreflightCoordinator } from './physical-preflight-coordinator.js';

export interface ProductionPhysicalPreflightProgress {
  readonly stage:
    | 'resolving_app_source'
    | 'building_app'
    | 'validating_app'
    | 'installing_app'
    | 'preparing_wda';
  readonly message: string;
}

export interface ProductionPhysicalPreflightInput {
  readonly plan: TestPlan;
  readonly workspace: string;
  readonly scheme?: string;
  readonly device: DeviceInfo;
  readonly bundleId: string;
  readonly stagingDir: string;
  readonly backend: DeviceBackend;
  readonly authorize: (action: string, resource: string) => Promise<boolean>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ProductionPhysicalPreflightProgress) => void;
}

export type ProductionPhysicalPreflight = (
  input: ProductionPhysicalPreflightInput,
) => Promise<PhysicalPreflightResult>;

export interface ProductionPhysicalPreflightDeps {
  readonly findProjectFile: typeof findProjectFile;
  readonly resolveAppSource: typeof resolveAppSource;
  readonly buildForPhysical: typeof buildForPhysical;
  readonly normalizePhysicalAppArtifact: typeof normalizePhysicalAppArtifact;
  readonly createDevicectlOps: typeof createDevicectlOps;
  readonly runCommand: XcodebuildProcessRunner;
}

/** Process boundary shared by physical build and artifact validation. */
export const runProductionPhysicalCommand: XcodebuildProcessRunner = async (cmd, args, options) => {
  options?.signal?.throwIfAborted();
  const process = Bun.spawn([cmd, ...args], {
    cwd: options?.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    signal: options?.signal,
    killSignal: 'SIGTERM',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
};

function requirePhysicalReadinessBackend(backend: DeviceBackend): DeviceBackend & {
  probePhysicalReadiness(signal?: AbortSignal): Promise<WdaReadinessProbe>;
} {
  const candidate = backend as DeviceBackend & {
    probePhysicalReadiness?: (signal?: AbortSignal) => Promise<WdaReadinessProbe>;
  };
  if (!candidate.probePhysicalReadiness) {
    throw new Error(
      'physical_preflight_unavailable: selected DeviceBackend cannot prove active WDA readiness',
    );
  }
  return candidate as DeviceBackend & {
    probePhysicalReadiness(signal?: AbortSignal): Promise<WdaReadinessProbe>;
  };
}

function blockedFromError(
  stage: Extract<PhysicalPreflightResult, { status: 'blocked' }>['stage'],
  code: Extract<PhysicalPreflightResult, { status: 'blocked' }>['failure']['code'],
  error: unknown,
): PhysicalPreflightResult {
  return {
    status: 'blocked',
    stage,
    failure: {
      code,
      stage,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

/**
 * Resolve/build/validate the AUT, install and launch it with devicectl, then
 * prove an active Appium/WDA session before exploration can read the UI.
 */
export function createProductionPhysicalPreflight(
  overrides: Partial<ProductionPhysicalPreflightDeps> = {},
  route: PhysicalRoute = 'route_b_wda_manager_managed',
): ProductionPhysicalPreflight {
  const deps: ProductionPhysicalPreflightDeps = {
    findProjectFile,
    resolveAppSource,
    buildForPhysical,
    normalizePhysicalAppArtifact,
    createDevicectlOps,
    runCommand: runProductionPhysicalCommand,
    ...overrides,
  };
  return async (input) => {
    input.signal?.throwIfAborted();
    input.onProgress?.({
      stage: 'resolving_app_source',
      message: 'Resolving the confirmed application source…',
    });
    const projectContainer = deps.findProjectFile(input.workspace);
    const source = deps.resolveAppSource({
      strategy: input.plan.appSource.strategy,
      workspaceRoot: input.workspace,
      targetKind: 'physical',
      destination: input.device.udid,
      expectedBundleId: input.bundleId,
      scheme: input.scheme,
      findProjectFile: deps.findProjectFile,
    });
    if (source.kind === 'unresolved') {
      return blockedFromError('app_source', 'app_source_unresolved', source.reason);
    }

    let sourcePath: string;
    let sourceKind: 'app' | 'ipa' | 'workspace' | 'build';
    if (source.kind === 'build_required') {
      if (!input.scheme) {
        return blockedFromError(
          'app_source',
          'app_source_unresolved',
          'physical_build_scheme_missing: Project Profile has no confirmed scheme',
        );
      }
      if (!projectContainer) {
        return blockedFromError(
          'app_source',
          'app_source_unresolved',
          'physical_build_container_missing: no Xcode workspace or project was found',
        );
      }
      const derivedDataPath = join(input.stagingDir, 'DerivedData');
      mkdirSync(derivedDataPath, { recursive: true });
      input.onProgress?.({
        stage: 'building_app',
        message: `Building ${input.scheme} for the selected iPhone…`,
      });
      const build = await deps.buildForPhysical(
        {
          projectRoot: input.workspace,
          projectContainer,
          scheme: input.scheme,
          configuration: 'Debug',
          udid: input.device.udid,
          allowProvisioningUpdates: true,
          derivedDataPath,
        },
        deps.runCommand,
      );
      if (build.exitCode !== 0 || !build.appPath) {
        const signing = diagnoseSigningError(build.log);
        const message = signing
          ? `physical_build_signing_failed: ${signing.reason} ${signing.fixGuide[0] ?? ''}`.trim()
          : `physical_build_failed: xcodebuild exited ${build.exitCode}${build.appPath ? '' : ' without resolving an application artifact'}`;
        return blockedFromError('app_source', 'app_source_unresolved', message);
      }
      sourcePath = build.appPath;
      sourceKind = 'build';
    } else {
      sourcePath = source.appPath;
      sourceKind = source.kind === 'existing_artifact' ? 'app' : source.artifactType;
    }

    input.onProgress?.({
      stage: 'validating_app',
      message: 'Validating the physical application artifact and signature…',
    });
    let artifact: PhysicalAppArtifact;
    try {
      artifact = await deps.normalizePhysicalAppArtifact({
        sourcePath,
        sourceKind,
        normalizationRoot: join(input.stagingDir, 'normalized-app'),
        expectedBundleId: input.bundleId,
        run: deps.runCommand,
      });
    } catch (error) {
      return blockedFromError('artifact_validation', 'artifact_invalid', error);
    }

    const readinessBackend = requirePhysicalReadinessBackend(input.backend);
    const devicectl = deps.createDevicectlOps();
    const coordinator = createPhysicalPreflightCoordinator({
      healthcheck: (deviceUdid, signal) => readinessBackend.healthcheck(deviceUdid, signal),
      isAppInstalled: async (deviceUdid, bundleId, signal) => {
        const result = await devicectl.isAppInstalled(deviceUdid, bundleId, signal);
        if (!result.success) throw new Error(result.error ?? 'devicectl app inventory failed');
        return result.installed;
      },
      installApp: (deviceUdid, appPath, signal) => {
        input.onProgress?.({
          stage: 'installing_app',
          message: 'Installing the validated application on the selected iPhone…',
        });
        return devicectl.installApp(deviceUdid, appPath, signal);
      },
      launchApp: (deviceUdid, bundleId, signal) =>
        devicectl.launchApp(deviceUdid, bundleId, undefined, signal),
      probeWda: (_route, signal) => {
        input.onProgress?.({
          stage: 'preparing_wda',
          message: 'Verifying the active Appium/WDA session…',
        });
        return readinessBackend.probePhysicalReadiness(signal);
      },
      requestPermission: async (_callId, action) => ({
        effect: (await input.authorize(action, `${input.bundleId}@${input.device.udid}`))
          ? 'allow'
          : 'deny',
      }),
      createCallId: () => `physical-preflight-${globalThis.crypto.randomUUID()}`,
    });
    return coordinator.run({
      artifact,
      deviceUdid: input.device.udid,
      route,
      confirmedTestPlan: true,
      repairWdaWhenBlocked: false,
      signal: input.signal,
    });
  };
}

export const runProductionPhysicalPreflight = createProductionPhysicalPreflight();
