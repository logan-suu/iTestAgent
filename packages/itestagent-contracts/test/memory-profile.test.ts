/**
 * memory-profile.test.ts — B05 scenario pack: parameterized memory-profile
 * scenario (promotion guide §6.2 "memory profiling mechanics → parameterized
 * migration"; fixed values like `20 MiB` / `3 rounds` become scenario
 * parameters and calibration data, never core hard-codes).
 */
import { describe, expect, it } from 'bun:test';
import {
  MEMORY_PROFILE_CALIBRATION,
  MemoryProfileScenarioParamsSchema,
  buildMemoryProfilePlan,
} from '../src/scenarios/memory-profile.js';

describe('MemoryProfileScenarioParamsSchema', () => {
  it('accepts explicit params', () => {
    const parsed = MemoryProfileScenarioParamsSchema.parse({
      thresholdMB: 25,
      rounds: 2,
      samplesPerRound: 12,
      stabilizationMs: 500,
    });
    expect(parsed.thresholdMB).toBe(25);
  });

  it('rejects non-positive rounds or thresholds', () => {
    expect(MemoryProfileScenarioParamsSchema.safeParse({ thresholdMB: 0 }).success).toBe(false);
    expect(MemoryProfileScenarioParamsSchema.safeParse({ rounds: -1 }).success).toBe(false);
  });
});

describe('MEMORY_PROFILE_CALIBRATION', () => {
  it('carries the historical calibration values as data (20 MiB / 3 rounds)', () => {
    expect(MEMORY_PROFILE_CALIBRATION.thresholdMB).toBe(20);
    expect(MEMORY_PROFILE_CALIBRATION.rounds).toBe(3);
  });

  it('is a valid params input itself', () => {
    expect(MemoryProfileScenarioParamsSchema.parse(MEMORY_PROFILE_CALIBRATION)).toBeDefined();
  });
});

describe('buildMemoryProfilePlan', () => {
  it('expands calibration defaults into a full round plan', () => {
    const plan = buildMemoryProfilePlan({});
    expect(plan.rounds).toHaveLength(MEMORY_PROFILE_CALIBRATION.rounds);
    for (const round of plan.rounds) {
      expect(round.samplesRequested).toBe(MEMORY_PROFILE_CALIBRATION.samplesPerRound);
      expect(round.stabilizationMs).toBe(MEMORY_PROFILE_CALIBRATION.stabilizationMs);
    }
    expect(paramsOf(plan).thresholdMB).toBe(MEMORY_PROFILE_CALIBRATION.thresholdMB);
  });

  it('honors overrides without mutating the calibration constant', () => {
    const plan = buildMemoryProfilePlan({ thresholdMB: 30, rounds: 1 });
    expect(paramsOf(plan).thresholdMB).toBe(30);
    expect(plan.rounds).toHaveLength(1);
    expect(MEMORY_PROFILE_CALIBRATION.thresholdMB).toBe(20);
  });

  function paramsOf(plan: ReturnType<typeof buildMemoryProfilePlan>) {
    return plan.params;
  }
});
