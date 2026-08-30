---
name: test-integration-itest
description: Run cumulative iTestAgent regression checks across every implemented phase, cross-phase integration tests, and package unit tests.
---

# Run cumulative integration checks

1. Read task status to determine `current_phase` and inspect `tests/integration/`.
2. Verify that cross-phase tests cover the actual cumulative data flow. Report gaps before adding tests, and modify tests only when the request includes implementation.
3. Run each existing `tests/integration/phase{N}/` suite from Phase 1 through the current phase, then `tests/integration/cross-phase/`, package unit tests, `bun run typecheck`, and `bun run lint`.
4. Do not invent a missing phase directory or treat an absent optional suite as passing. State its status explicitly.
5. Diagnose every failure as product regression, test defect, compatibility break, environment limitation, or inconclusive using code and AC evidence.
6. Never weaken assertions or substitute mocks to obtain a green result.
7. Report results by layer and phase, totals, commands, durations, skips, missing coverage, and the cumulative baseline conclusion.
8. Do not update task status unless the request also authorizes the corresponding phase task workflow.
