/**
 * Memory profile scenario → runtime parameter mapping — B22 module split
 * (promotion guide §11.3 "parameterized memory profile"; §6.2 fixed values
 * become calibration data).
 *
 * Mirrors the B05 contracts MEMORY_PROFILE_CALIBRATION defaults (20 MiB / 3
 * rounds) so the runner shares one calibration source of truth; overrides
 * are honored per field.
 */

/** Calibration defaults mirrored from B05 MEMORY_PROFILE_CALIBRATION. */
export const MEMORY_PROFILE_RUNTIME_DEFAULTS = {
  thresholdMB: 20,
  rounds: 3,
  samplesPerRound: 10,
  stabilizationMs: 2_000,
} as const;

export interface MemoryProfileRuntimeParams {
  thresholdMB: number;
  rounds: number;
  samplesPerRound: number;
  stabilizationMs: number;
}

/** Resolves partial scenario overrides against the calibration defaults. */
export function scenarioToRuntimeParams(
  overrides: Partial<MemoryProfileRuntimeParams> = {},
): MemoryProfileRuntimeParams {
  return {
    thresholdMB: overrides.thresholdMB ?? MEMORY_PROFILE_RUNTIME_DEFAULTS.thresholdMB,
    rounds: overrides.rounds ?? MEMORY_PROFILE_RUNTIME_DEFAULTS.rounds,
    samplesPerRound: overrides.samplesPerRound ?? MEMORY_PROFILE_RUNTIME_DEFAULTS.samplesPerRound,
    stabilizationMs: overrides.stabilizationMs ?? MEMORY_PROFILE_RUNTIME_DEFAULTS.stabilizationMs,
  };
}
