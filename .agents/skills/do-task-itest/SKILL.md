---
name: do-task-itest
description: Execute a specified iTestAgent task ID through dependency checks, documentation grounding, plan approval, implementation, and verification.
---

# Execute a specified iTestAgent task

Require a task ID. If none is supplied, list current-phase `ready` and `pending` tasks and ask for one.

1. Read `AGENTS.md`, `docs/INDEX.md`, task status, deferred items, and Git status.
2. Locate the task and reject duplicate execution of a `done` task. For `in_progress`, confirm that the user wants to resume it.
3. Apply the dependency cascade, then verify every dependency is `done`. Do not bypass phase boundaries.
4. Set the task to `in_progress` only after the user has confirmed starting it.
5. Read every `documents_required` source and the exact story/AC section. Quote the applicable AC and architecture constraints verbatim.
6. Stop on conflicting, ambiguous, untestable, missing, or obsolete documentation.
7. Produce an implementation plan covering changed files, interfaces/contracts, tests, documentation, and verification evidence. Wait for explicit approval under R8.
8. Implement in small checkable units. Preserve R1-R14, package layering, `itestagent-*` naming, explicit uncertainty, and permission gates.
9. Run relevant tests plus `bun run typecheck` and `bun run lint`. Perform and record G5/G5-SIM validation for affected physical-device or Simulator behavior.
10. Update related documentation and add an ADR for a major technical or requirement decision.
11. Keep the task `in_progress`. Use `$commit-pr-itest` for code tasks or `$pr-merge-itest` for human confirmation of non-code work.
