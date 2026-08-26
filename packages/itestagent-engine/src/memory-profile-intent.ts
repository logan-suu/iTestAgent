/**
 * Memory Profile intent — B16 module split (promotion guide §11.3 "engine
 * analysis/intents"; B05 MEMORY_PROFILE_CALIBRATION defaults).
 *
 * Builds the engine-side memory-profile intent with calibration defaults
 * (20 MiB threshold) unless overridden.
 */

export interface MemoryProfileIntentOverrides {
  thresholdMB?: number;
  rounds?: number;
}

export interface MemoryProfileIntent {
  scope: 'memory-profile';
  thresholdMB: number;
  rounds: number;
}

export function buildMemoryProfileIntent(
  overrides: MemoryProfileIntentOverrides = {},
): MemoryProfileIntent {
  return {
    scope: 'memory-profile',
    thresholdMB: overrides.thresholdMB ?? 20,
    rounds: overrides.rounds ?? 3,
  };
}
