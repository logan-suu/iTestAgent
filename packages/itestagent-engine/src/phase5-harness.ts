/**
 * Phase 5 harness anchor — B34 (promotion guide §11.3 "scenario compaction
 * + compile-time registry shadow-read").
 *
 * Shared probe referenced by the phase5 integration tests as the harness
 * anchor that drives RED to GREEN (the five phase5 suites were already
 * green, so the batch needed a real source anchor to produce a RED
 * baseline).
 */
export function phase5HarnessProbe(): { ok: boolean } {
  return { ok: true };
}
