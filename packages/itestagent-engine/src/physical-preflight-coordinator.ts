import type {
  HealthCheckResult,
  PhysicalAppArtifact,
  PhysicalPreflightResult,
  PhysicalRoute,
  WdaReadinessProbe,
} from 'itestagent-contracts';

interface OperationResult {
  success: boolean;
  error?: string;
}

interface PermissionResult {
  effect: 'allow' | 'deny';
}

export interface PhysicalPreflightCoordinatorDeps {
  healthcheck(deviceUdid: string, signal?: AbortSignal): Promise<HealthCheckResult>;
  isAppInstalled(deviceUdid: string, bundleId: string, signal?: AbortSignal): Promise<boolean>;
  installApp(deviceUdid: string, appPath: string, signal?: AbortSignal): Promise<OperationResult>;
  launchApp(deviceUdid: string, bundleId: string, signal?: AbortSignal): Promise<OperationResult>;
  probeWda(route: PhysicalRoute, signal?: AbortSignal): Promise<WdaReadinessProbe>;
  prepareWda?(route: PhysicalRoute, signal?: AbortSignal): Promise<OperationResult>;
  requestPermission(
    callId: string,
    action: 'replace_device_app' | 'prepare_wda',
    resource: string,
    signal?: AbortSignal,
  ): Promise<PermissionResult>;
  createCallId(): string;
}

export interface PhysicalPreflightInput {
  artifact: PhysicalAppArtifact;
  deviceUdid: string;
  route: PhysicalRoute;
  confirmedTestPlan: boolean;
  repairWdaWhenBlocked?: boolean;
  signal?: AbortSignal;
}

function blocked(
  stage: Exclude<PhysicalPreflightResult['stage'], 'ready'>,
  code: Extract<PhysicalPreflightResult, { status: 'blocked' }>['failure']['code'],
  message: string,
  artifact?: PhysicalAppArtifact,
  wda?: WdaReadinessProbe,
): PhysicalPreflightResult {
  return {
    status: 'blocked',
    stage,
    ...(artifact ? { artifact } : {}),
    ...(wda ? { wda } : {}),
    failure: { code, stage, message },
  };
}

function cancelled(
  stage: Exclude<PhysicalPreflightResult['stage'], 'ready'>,
  message: string,
  artifact: PhysicalAppArtifact,
): PhysicalPreflightResult {
  return {
    status: 'cancelled',
    stage,
    artifact,
    failure: { code: 'cancelled', stage, message },
  };
}

function cancelledAfterAbort(
  input: PhysicalPreflightInput,
  stage: Exclude<PhysicalPreflightResult['stage'], 'ready'>,
): PhysicalPreflightResult | undefined {
  if (!input.signal?.aborted) return undefined;
  const reason = input.signal.reason;
  return cancelled(
    stage,
    reason instanceof Error ? reason.message : 'The physical preflight was aborted.',
    input.artifact,
  );
}

function validateWdaProbeIdentity(
  probe: WdaReadinessProbe,
  input: Pick<PhysicalPreflightInput, 'deviceUdid' | 'route'>,
  artifact: PhysicalAppArtifact,
): PhysicalPreflightResult | undefined {
  if (probe.route !== input.route) {
    return blocked(
      'wda_inventory',
      'wda_route_not_selected',
      'The WDA probe route does not match the selected physical route.',
      artifact,
      probe,
    );
  }
  if (probe.targetDeviceUdid !== input.deviceUdid) {
    return blocked(
      'wda_inventory',
      'wda_identity_mismatch',
      'The WDA probe evidence belongs to a different physical device.',
      artifact,
      probe,
    );
  }
  return undefined;
}

/** Run app and WDA gates only; task 6.5 owns subsequent test-step dispatch. */
export function createPhysicalPreflightCoordinator(deps: PhysicalPreflightCoordinatorDeps): {
  run(input: PhysicalPreflightInput): Promise<PhysicalPreflightResult>;
} {
  return {
    async run(input): Promise<PhysicalPreflightResult> {
      const initiallyCancelled = cancelledAfterAbort(input, 'device_health');
      if (initiallyCancelled) return initiallyCancelled;
      if (!input.confirmedTestPlan) {
        return blocked(
          'permission',
          'permission_denied',
          'Physical installation requires a confirmed TestPlan.',
          input.artifact,
        );
      }

      let health: HealthCheckResult;
      try {
        health = await deps.healthcheck(input.deviceUdid, input.signal);
      } catch (error) {
        const aborted = cancelledAfterAbort(input, 'device_health');
        if (aborted) return aborted;
        return blocked(
          'device_health',
          'device_health_failed',
          `Physical device healthcheck failed: ${error instanceof Error ? error.message : String(error)}`,
          input.artifact,
        );
      }
      if (!health.healthy) {
        return blocked(
          'device_health',
          'device_health_failed',
          health.details ?? 'The physical device healthcheck failed.',
          input.artifact,
        );
      }
      const cancelledAfterHealth = cancelledAfterAbort(input, 'app_inventory');
      if (cancelledAfterHealth) return cancelledAfterHealth;

      let installed: boolean;
      try {
        installed = await deps.isAppInstalled(
          input.deviceUdid,
          input.artifact.bundleId,
          input.signal,
        );
      } catch (error) {
        const aborted = cancelledAfterAbort(input, 'app_inventory');
        if (aborted) return aborted;
        return blocked(
          'app_inventory',
          'app_inventory_failed',
          `Application inventory failed: ${error instanceof Error ? error.message : String(error)}`,
          input.artifact,
        );
      }
      const cancelledAfterInventory = cancelledAfterAbort(input, 'permission');
      if (cancelledAfterInventory) return cancelledAfterInventory;
      if (installed) {
        let permission: PermissionResult;
        try {
          permission = await deps.requestPermission(
            deps.createCallId(),
            'replace_device_app',
            `${input.deviceUdid}:${input.artifact.bundleId}`,
            input.signal,
          );
        } catch (error) {
          const aborted = cancelledAfterAbort(input, 'permission');
          if (aborted) return aborted;
          return blocked(
            'permission',
            'permission_denied',
            error instanceof Error ? error.message : String(error),
            input.artifact,
          );
        }
        if (permission.effect !== 'allow') {
          return cancelled(
            'permission',
            'The user declined replacing the installed application.',
            input.artifact,
          );
        }
        const cancelledAfterPermission = cancelledAfterAbort(input, 'install');
        if (cancelledAfterPermission) return cancelledAfterPermission;
      }

      let install: OperationResult;
      try {
        install = await deps.installApp(input.deviceUdid, input.artifact.appPath, input.signal);
      } catch (error) {
        const aborted = cancelledAfterAbort(input, 'install');
        if (aborted) return aborted;
        return blocked(
          'install',
          'install_failed',
          error instanceof Error ? error.message : String(error),
          input.artifact,
        );
      }
      if (!install.success) {
        return blocked(
          'install',
          'install_failed',
          install.error ?? 'Application installation failed.',
          input.artifact,
        );
      }
      const cancelledAfterInstall = cancelledAfterAbort(input, 'launch');
      if (cancelledAfterInstall) return cancelledAfterInstall;

      let launch: OperationResult;
      try {
        launch = await deps.launchApp(input.deviceUdid, input.artifact.bundleId, input.signal);
      } catch (error) {
        const aborted = cancelledAfterAbort(input, 'launch');
        if (aborted) return aborted;
        return blocked(
          'launch',
          'launch_failed',
          error instanceof Error ? error.message : String(error),
          input.artifact,
        );
      }
      if (!launch.success) {
        return blocked(
          'launch',
          'launch_failed',
          launch.error ?? 'Application launch failed.',
          input.artifact,
        );
      }
      const cancelledAfterLaunch = cancelledAfterAbort(
        input,
        input.route === 'route_c_appium_managed' ? 'appium_session' : 'wda_status',
      );
      if (cancelledAfterLaunch) return cancelledAfterLaunch;

      let wda: WdaReadinessProbe;
      try {
        wda = await deps.probeWda(input.route, input.signal);
      } catch (error) {
        const aborted = cancelledAfterAbort(
          input,
          input.route === 'route_c_appium_managed' ? 'appium_session' : 'wda_status',
        );
        if (aborted) return aborted;
        return blocked(
          input.route === 'route_c_appium_managed' ? 'appium_session' : 'wda_status',
          input.route === 'route_c_appium_managed' ? 'appium_session_failed' : 'wda_status_failed',
          error instanceof Error ? error.message : String(error),
          input.artifact,
        );
      }
      const initialIdentityFailure = validateWdaProbeIdentity(wda, input, input.artifact);
      if (initialIdentityFailure) return initialIdentityFailure;

      if (!wda.ready && input.repairWdaWhenBlocked && deps.prepareWda) {
        let permission: PermissionResult;
        try {
          permission = await deps.requestPermission(
            deps.createCallId(),
            'prepare_wda',
            `${input.deviceUdid}:${wda.targetWdaBundleId}`,
            input.signal,
          );
        } catch (error) {
          const aborted = cancelledAfterAbort(input, 'permission');
          if (aborted) return aborted;
          return blocked(
            'permission',
            'permission_denied',
            error instanceof Error ? error.message : String(error),
            input.artifact,
            wda,
          );
        }
        if (permission.effect !== 'allow') {
          return cancelled('permission', 'The user declined WDA preparation.', input.artifact);
        }
        let preparation: OperationResult;
        try {
          preparation = await deps.prepareWda(input.route, input.signal);
        } catch (error) {
          const aborted = cancelledAfterAbort(input, 'wda_launch');
          if (aborted) return aborted;
          return blocked(
            'wda_launch',
            'wda_signing_or_configuration_failed',
            error instanceof Error ? error.message : String(error),
            input.artifact,
            wda,
          );
        }
        if (!preparation.success) {
          return blocked(
            'wda_launch',
            'wda_signing_or_configuration_failed',
            preparation.error ?? 'WDA preparation failed.',
            input.artifact,
            wda,
          );
        }
        const cancelledAfterPreparation = cancelledAfterAbort(
          input,
          input.route === 'route_c_appium_managed' ? 'appium_session' : 'wda_status',
        );
        if (cancelledAfterPreparation) return cancelledAfterPreparation;
        try {
          wda = await deps.probeWda(input.route, input.signal);
        } catch (error) {
          const aborted = cancelledAfterAbort(
            input,
            input.route === 'route_c_appium_managed' ? 'appium_session' : 'wda_status',
          );
          if (aborted) return aborted;
          return blocked(
            input.route === 'route_c_appium_managed' ? 'appium_session' : 'wda_status',
            input.route === 'route_c_appium_managed'
              ? 'appium_session_failed'
              : 'wda_status_failed',
            error instanceof Error ? error.message : String(error),
            input.artifact,
          );
        }
        const repairedIdentityFailure = validateWdaProbeIdentity(wda, input, input.artifact);
        if (repairedIdentityFailure) return repairedIdentityFailure;
      }

      if (!wda.ready) {
        return blocked(
          wda.stage === 'ready' ? 'wda_status' : wda.stage,
          wda.failureCode ?? 'wda_status_failed',
          wda.details ?? 'WDA active readiness probe failed.',
          input.artifact,
          wda,
        );
      }

      return {
        status: 'ready',
        stage: 'ready',
        artifact: input.artifact,
        wda,
      };
    },
  };
}
