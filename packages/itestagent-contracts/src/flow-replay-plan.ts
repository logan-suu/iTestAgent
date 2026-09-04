import { z } from 'zod';
import { TargetKindSchema } from './device-types.js';
import { RunIdSchema } from './run-id.js';
import { ArtifactPolicySchema } from './test-plan.js';

export const FLOW_REPLAY_PLAN_SCHEMA_VERSION = 'itestagent.flow-replay-plan.v1';

const FlowReplaySelectionSchema = z
  .object({
    status: z.enum(['selected', 'failed']),
    backend: z.string().min(1).optional(),
    reasonCode: z.string().min(1),
    message: z.string().optional(),
  })
  .strict()
  .superRefine((selection, ctx) => {
    if (selection.status === 'selected' && !selection.backend) {
      ctx.addIssue({
        code: 'custom',
        path: ['backend'],
        message: 'selected backend outcome requires backend',
      });
    }
    if (selection.status === 'failed' && selection.backend) {
      ctx.addIssue({
        code: 'custom',
        path: ['backend'],
        message: 'failed backend selection must not claim a selected backend',
      });
    }
  });

const FlowReplayReadinessSchema = z
  .object({
    status: z.enum(['ready', 'failed', 'not_reached']),
    reasonCode: z.string().min(1),
    message: z.string().optional(),
  })
  .strict();

export const FlowReplayPlanSchema = z
  .object({
    schemaVersion: z.literal(FLOW_REPLAY_PLAN_SCHEMA_VERSION),
    runId: RunIdSchema,
    flow: z
      .object({
        flowId: z.string().min(1),
        source: z.enum(['global', 'project']),
        sourcePath: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    target: z
      .object({
        targetKind: TargetKindSchema,
        deviceId: z.string().min(1),
      })
      .strict(),
    selection: FlowReplaySelectionSchema,
    readiness: FlowReplayReadinessSchema,
    artifacts: ArtifactPolicySchema,
  })
  .strict();

export type FlowReplayPlan = z.infer<typeof FlowReplayPlanSchema>;

export function parseFlowReplayPlan(raw: unknown): FlowReplayPlan {
  return FlowReplayPlanSchema.parse(raw);
}
