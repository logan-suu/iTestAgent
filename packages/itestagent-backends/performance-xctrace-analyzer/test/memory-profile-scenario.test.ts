/**
 * memory-profile-scenario.test.ts — B22 scenario→runtime parameter mapping
 * (promotion guide §11.3 "parameterized memory profile"; §6.2 fixed values
 * become calibration data).
 *
 * Mirrors the B05 contracts MEMORY_PROFILE_CALIBRATION defaults (20 MiB / 3
 * rounds) so the runner shares one calibration source of truth.
 */
import { describe, expect, it } from 'bun:test';
import { scenarioToRuntimeParams } from '../src/memory-profile-scenario.js';

describe('scenarioToRuntimeParams', () => {
  it('applies calibration defaults when no overrides are given', () => {
    const params = scenarioToRuntimeParams({});
    expect(params.thresholdMB).toBe(20); // B05 MEMORY_PROFILE_CALIBRATION
    expect(params.rounds).toBe(3);
  });

  it('honors explicit overrides', () => {
    expect(scenarioToRuntimeParams({ thresholdMB: 30 }).thresholdMB).toBe(30);
    expect(scenarioToRuntimeParams({ rounds: 1 }).rounds).toBe(1);
  });
});
