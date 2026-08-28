/**
 * Memory profile sample parsing — B22 module split (promotion guide §11.3
 * "parameterized memory profile").
 *
 * Parses the "timestamp:valueMB" sample sequence emitted by profiling tools
 * into typed samples; unparseable tokens fail closed (R5).
 */
import type { MemoryProfileSample } from './memory-profile-types.js';

/**
 * Parses a comma-separated "timestampMs:valueMB" sequence.
 * Empty input yields an empty list; any malformed token fails closed.
 */
export function parseMemorySamples(input: string): MemoryProfileSample[] {
  if (input.trim().length === 0) return [];
  const samples: MemoryProfileSample[] = [];
  for (const token of input.split(',')) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(':');
    const timestampMs = Number.parseFloat(parts[0] ?? '');
    const valueMB = Number.parseFloat(parts[1] ?? '');
    if (parts.length !== 2 || !Number.isFinite(timestampMs) || !Number.isFinite(valueMB)) {
      throw new Error(`memory profile: unparseable sample token "${trimmed}"`);
    }
    samples.push({ timestampMs, valueMB });
  }
  return samples;
}
