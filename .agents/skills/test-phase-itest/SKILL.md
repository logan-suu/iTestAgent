---
name: test-phase-itest
description: Audit, complete, and run the current iTestAgent phase integration suite against documented cross-package behavior.
---

# Verify the current phase

1. Read `AGENTS.md`, `docs/INDEX.md`, task status, deferred items, and the current phase's completed task notes.
2. Inventory actual public cross-package interactions and compare them with `tests/integration/phase{N}/` coverage.
3. Report missing P0 orchestration, P1 backend, and P2 contract paths before writing tests.
4. When the user authorized implementation, add the smallest tests needed for real public behavior. Prefer real local dependencies; explain unavoidable mocks. Never weaken assertions or use unjustified skips.
5. Run `bun run typecheck`, `bun run lint`, and `bun test tests/integration/phase{N}/`.
6. Diagnose failures against both production code and test assumptions. Fix only within the authorized scope; explicitly record environment limitations.
7. When this work corresponds to the phase `integration_test` task, set it to `in_progress` after user confirmation and record test paths/counts. Keep it `in_progress` until the PR is human-merged.
8. Audit open deferred items targeting the phase and report whether each was proven resolved or remains open.
9. Produce a phase report with commands, counts, covered paths, missing paths, gate results, and evidence obligations.
