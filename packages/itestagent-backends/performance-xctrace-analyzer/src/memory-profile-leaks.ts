/**
 * Memory profile leaks analysis — B22 module split (promotion guide §11.3
 * "parameterized memory profile").
 *
 * Thin facade over the B21 leaks report parser so memory-profile consumers
 * have a single import for leak facts.
 */
import { type LeaksSummary, parseLeaksReport } from './xctrace-leaks-parser.js';

/** Parses the leaks summary from profiling tool text. */
export function analyzeMemoryProfileLeaks(raw: string): LeaksSummary {
  return parseLeaksReport(raw);
}
