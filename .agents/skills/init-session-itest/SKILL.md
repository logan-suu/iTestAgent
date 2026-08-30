---
name: init-session-itest
description: Initialize an iTestAgent development session by loading project rules, locating current work, and locking the relevant acceptance criteria before implementation.
---

# Initialize an iTestAgent session

Do not write implementation code during initialization.

1. Read `AGENTS.md`, `docs/INDEX.md`, `docs/05-planning/task-status.json`, and `docs/05-planning/deferred-items.json`.
2. Apply the idempotent `pending -> ready` cascade only when every dependency is `done`.
3. Prefer a task ID supplied by the user. Otherwise inspect `current_phase`, then select an `in_progress` task before the first `ready` task. Do not silently choose among multiple plausible tasks.
4. Verify every dependency and report open deferred items targeting the current phase.
5. Read only the task's `documents_required` sections plus directly relevant indexed sections.
6. Quote the applicable AC or architecture constraint verbatim, as required by `AGENTS.md`.
7. Report the task ID, title, story, phase, dependency state, required documents, AC, and relevant R1-R14 constraints.
8. Stop if the documents conflict, are ambiguous, are untestable, or omit a required dependency.
9. Wait for explicit user approval before changing the task to `in_progress` or producing an implementation plan.

Use `$do-task-itest` for a specified task or `$next-task-itest` to select the next ready task after initialization.
