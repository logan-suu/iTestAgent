import { z } from 'zod';
import { RunIdSchema } from './run-id.js';
import { RunStepSchema } from './run-result-contracts.js';

export const RUN_STEPS_SCHEMA_VERSION = 'itestagent.run-steps.v1';

export const RunStepsDocumentSchema = z
  .object({
    schemaVersion: z.literal(RUN_STEPS_SCHEMA_VERSION),
    runId: RunIdSchema,
    steps: z.array(RunStepSchema.strict()),
  })
  .strict()
  .superRefine((document, ctx) => {
    const stepIds = new Set<string>();
    for (const [index, step] of document.steps.entries()) {
      if (stepIds.has(step.stepId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'stepId'],
          message: `duplicate stepId "${step.stepId}"`,
        });
      }
      stepIds.add(step.stepId);
      if (step.sequence !== index + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'sequence'],
          message: `sequence must be ${index + 1}`,
        });
      }
    }
  });

export type RunStepsDocument = z.infer<typeof RunStepsDocumentSchema>;

export function parseRunStepsDocument(raw: unknown): RunStepsDocument {
  return RunStepsDocumentSchema.parse(raw);
}
