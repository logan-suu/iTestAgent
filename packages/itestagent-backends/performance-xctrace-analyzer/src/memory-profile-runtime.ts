/**
 * Memory profile runtime state — B22 module split (promotion guide §11.3
 * "parameterized memory profile").
 *
 * Tracks the in-memory sampling state for a profile run (samples collected
 * so far) and folds them into a per-round summary.
 */
import type { MemoryProfileRound, MemoryProfileSample } from './memory-profile-types.js';

export interface MemoryProfileRuntimeState {
  samples: MemoryProfileSample[];
  record(sample: MemoryProfileSample): void;
  toRound(index: number): MemoryProfileRound;
  reset(): void;
}

/** Creates a fresh runtime state accumulator. */
export function createMemoryProfileRuntime(): MemoryProfileRuntimeState {
  let samples: MemoryProfileSample[] = [];

  const peakAndAvg = (): { peakMB: number; avgMB: number } => {
    if (samples.length === 0) return { peakMB: 0, avgMB: 0 };
    const peakMB = Math.max(...samples.map((sample) => sample.valueMB));
    const avgMB = samples.reduce((sum, sample) => sum + sample.valueMB, 0) / samples.length;
    return { peakMB, avgMB };
  };

  return {
    get samples(): MemoryProfileSample[] {
      return samples;
    },
    record(sample: MemoryProfileSample): void {
      samples.push(sample);
    },
    toRound(index: number): MemoryProfileRound {
      const { peakMB, avgMB } = peakAndAvg();
      return { index, samples: [...samples], peakMB, avgMB };
    },
    reset(): void {
      samples = [];
    },
  };
}
