import { z } from 'zod';

/** Canonical run identifier accepted by schemas, writers, readers, and CLI surfaces. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const RUN_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

export const RUN_ID_MAX_LENGTH = 128;

export const RunIdSchema = z
  .string()
  .min(1)
  .max(RUN_ID_MAX_LENGTH)
  .regex(RUN_ID_PATTERN, 'unsafe runId');

export type RunId = z.infer<typeof RunIdSchema>;

export function isSafeRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value);
}
