---
name: next-task-itest
description: Select the next ready iTestAgent task and guide it through the confirmation-gated EPCC-V workflow.
---

# Start the next iTestAgent task

1. Read `AGENTS.md`, `docs/INDEX.md`, task status, deferred items, and `git status --porcelain`.
2. If unrelated uncommitted changes exist, report them and stop before changing task state.
3. Apply the idempotent dependency cascade from `pending` to `ready`.
4. Report open deferred items whose `target_phase` matches `current_phase`.
5. If an `in_progress` task exists, offer to resume it instead of selecting new work. Otherwise select the first `ready` task in the current phase.
6. Verify all dependencies are `done`, then report task ID, title, story, dependencies, and required documents.
7. Wait for explicit user confirmation before starting the task.
8. Explore the required documentation, quote applicable AC and constraints verbatim, and stop on ambiguity or conflict.
9. Produce a concrete plan covering files, interfaces, schemas, tests, documentation, and G5/G5-SIM evidence where applicable.
10. Wait for explicit approval of that plan. Only then set the task to `in_progress` and implement in small verified units.
11. Run proportionate checks, including `bun run typecheck`, `bun run lint`, and relevant tests. Real-device or Simulator capabilities require G5 or G5-SIM evidence.
12. Keep the task `in_progress` after delivery. Direct code work to `$commit-pr-itest`; direct non-code deliverables to `$pr-merge-itest` for human confirmation.
