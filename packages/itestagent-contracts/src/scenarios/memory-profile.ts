import { z } from 'zod';

/**
 * Memory-profile scenario parameters — B05 scenario pack (promotion guide
 * §6.2: "memory profiling mechanics → parameterized migration"; the fixed
 * `20 MiB` / `3 rounds` of the experimental tree become calibration DATA
 * here, never core hard-codes).
 */

export const MEMORY_PROFILE_CALIBRATION = {
  /** Regression threshold in MB (historical calibration value). */
  thresholdMB: 20,
  /** Observation rounds per profile run. */
  rounds: 3,
  /** Samples requested per round. */
  samplesPerRound: 10,
  /** Stabilization wait before each round's sampling window, ms. */
  stabilizationMs: 2_000,
} as const;

export const MemoryProfileScenarioParamsSchema = z
  .object({
    thresholdMB: z.number().positive().default(MEMORY_PROFILE_CALIBRATION.thresholdMB),
    rounds: z.number().int().positive().default(MEMORY_PROFILE_CALIBRATION.rounds),
    samplesPerRound: z
      .number()
      .int()
      .positive()
      .default(MEMORY_PROFILE_CALIBRATION.samplesPerRound),
    stabilizationMs: z.number().nonnegative().default(MEMORY_PROFILE_CALIBRATION.stabilizationMs),
  })
  .strict();

export type MemoryProfileScenarioParams = z.infer<typeof MemoryProfileScenarioParamsSchema>;

export interface MemoryProfileRoundPlan {
  roundIndex: number;
  samplesRequested: number;
  stabilizationMs: number;
}

export interface MemoryProfileScenarioPlan {
  params: MemoryProfileScenarioParams;
  rounds: MemoryProfileRoundPlan[];
}

/**
 * Expands parameters into a concrete per-round plan.
 * Accepts partial overrides; omitted fields fall back to calibration.
 */
export function buildMemoryProfilePlan(
  overrides: Partial<MemoryProfileScenarioParams> = {},
): MemoryProfileScenarioPlan {
  const params = MemoryProfileScenarioParamsSchema.parse(overrides);
  const rounds: MemoryProfileRoundPlan[] = Array.from(
    { length: params.rounds },
    (_, roundIndex) => ({
      roundIndex,
      samplesRequested: params.samplesPerRound,
      stabilizationMs: params.stabilizationMs,
    }),
  );
  return { params, rounds };
}
