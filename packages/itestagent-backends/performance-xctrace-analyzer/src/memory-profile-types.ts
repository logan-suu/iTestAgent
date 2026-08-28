/**
 * Memory profile shared types — B22 module split (promotion guide §11.3
 * "parameterized memory profile").
 */

export interface MemoryProfileSample {
  /** Milliseconds since profile start. */
  timestampMs: number;
  /** Sampled memory in MB. */
  valueMB: number;
}

export interface MemoryProfileRound {
  index: number;
  samples: MemoryProfileSample[];
  peakMB: number;
  avgMB: number;
}
