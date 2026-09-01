import { z } from 'zod';
import { PhysicalRouteSchema } from './physical-mvp.js';

/** Ordered checkpoints completed before physical-device test execution. */
export const PHYSICAL_PREFLIGHT_STAGE_VALUES = [
  'app_source',
  'artifact_normalization',
  'artifact_validation',
  'device_health',
  'app_inventory',
  'permission',
  'install',
  'launch',
  'wda_inventory',
  'wda_launch',
  'wda_tunnel',
  'wda_status',
  'appium_session',
  'ready',
] as const;

export const PhysicalPreflightStageSchema = z.enum(PHYSICAL_PREFLIGHT_STAGE_VALUES);

export type PhysicalPreflightStage = z.infer<typeof PhysicalPreflightStageSchema>;

export const WDA_READINESS_STAGE_VALUES = [
  'wda_inventory',
  'wda_launch',
  'wda_tunnel',
  'wda_status',
  'appium_session',
  'ready',
] as const;

export const WdaReadinessStageSchema = z.enum(WDA_READINESS_STAGE_VALUES);

export type WdaReadinessStage = z.infer<typeof WdaReadinessStageSchema>;

export const PHYSICAL_PREFLIGHT_FAILURE_CODE_VALUES = [
  'app_source_unresolved',
  'ipa_unsafe_entry',
  'ipa_payload_invalid',
  'artifact_invalid',
  'artifact_incompatible',
  'device_health_failed',
  'app_inventory_failed',
  'permission_denied',
  'install_failed',
  'launch_failed',
  'wda_route_not_selected',
  'wda_identity_mismatch',
  'wda_not_installed',
  'wda_signing_or_configuration_failed',
  'wda_launch_failed',
  'wda_tunnel_failed',
  'wda_status_failed',
  'appium_session_failed',
  'cancelled',
] as const;

export const PhysicalPreflightFailureCodeSchema = z.enum(PHYSICAL_PREFLIGHT_FAILURE_CODE_VALUES);

export type PhysicalPreflightFailureCode = z.infer<typeof PhysicalPreflightFailureCodeSchema>;

/** Validated, non-secret facts about the application selected for installation. */
export const PhysicalAppArtifactSchema = z
  .object({
    sourceKind: z.enum(['app', 'ipa', 'workspace', 'build']),
    sourcePath: z.string().min(1),
    appPath: z.string().min(1),
    bundleId: z.string().min(1),
    executable: z.string().min(1),
    supportedPlatforms: z.array(z.string().min(1)).min(1),
    architectures: z.array(z.string().min(1)).min(1),
    signingValid: z.literal(true),
  })
  .strict();

export type PhysicalAppArtifact = z.infer<typeof PhysicalAppArtifactSchema>;

/** Evidence from an active, route-specific WDA readiness probe. */
export const WdaReadinessProbeSchema = z
  .object({
    route: PhysicalRouteSchema,
    stage: WdaReadinessStageSchema,
    ready: z.boolean(),
    targetDeviceUdid: z.string().min(1),
    targetWdaBundleId: z.string().min(1),
    waitedMs: z.number().int().nonnegative(),
    failureCode: PhysicalPreflightFailureCodeSchema.optional(),
    details: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((probe, context) => {
    if (probe.ready && probe.stage !== 'ready') {
      context.addIssue({
        code: 'custom',
        path: ['stage'],
        message: 'A ready WDA probe must finish at the ready stage',
      });
    }
    if (probe.ready && probe.failureCode !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'A ready WDA probe cannot include a failure code',
      });
    }
    if (!probe.ready && probe.failureCode === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'A blocked WDA probe must include a failure code',
      });
    }
  });

export type WdaReadinessProbe = z.infer<typeof WdaReadinessProbeSchema>;

const PhysicalPreflightFailureSchema = z
  .object({
    code: PhysicalPreflightFailureCodeSchema,
    stage: PhysicalPreflightStageSchema,
    message: z.string().min(1),
  })
  .strict();

export const PhysicalPreflightResultSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        status: z.literal('ready'),
        stage: z.literal('ready'),
        artifact: PhysicalAppArtifactSchema,
        wda: WdaReadinessProbeSchema.refine((probe) => probe.ready, {
          message: 'A ready physical preflight requires a ready WDA probe',
        }),
      })
      .strict(),
    z
      .object({
        status: z.literal('blocked'),
        stage: PhysicalPreflightStageSchema,
        artifact: PhysicalAppArtifactSchema.optional(),
        wda: WdaReadinessProbeSchema.optional(),
        failure: PhysicalPreflightFailureSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal('cancelled'),
        stage: PhysicalPreflightStageSchema,
        artifact: PhysicalAppArtifactSchema.optional(),
        failure: PhysicalPreflightFailureSchema.extend({
          code: z.literal('cancelled'),
        }),
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (result.status !== 'ready' && result.stage !== result.failure.stage) {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'stage'],
        message: 'Failure stage must match the enclosing preflight stage',
      });
    }
  });

export type PhysicalPreflightResult = z.infer<typeof PhysicalPreflightResultSchema>;
