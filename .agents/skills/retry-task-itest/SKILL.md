---
name: retry-task-itest
description: Resume a failed or interrupted iTestAgent task from its last verified point without repeating completed work.
---

# Retry an iTestAgent task

1. Read task status, deferred items, Git status, and recent task notes.
2. Use a supplied task ID or locate the current `in_progress` task. If none exists, report ready tasks and stop.
3. Report the interruption reason, existing changes, completed checks, remaining work, and any open deferred items.
4. Confirm with the user before resuming when the task identity or recovery point is ambiguous.
5. Re-read the task's required documents and applicable AC. Do not assume prior conversational context is still valid.
6. Continue from the last verified EPCC-V step. Do not redo completed work unless evidence is stale or the underlying files changed.
7. Diagnose another failure from evidence, record the cause, and stop for user input when no safe in-scope recovery remains.
8. On success, run the relevant checks and keep the task `in_progress`; direct the next action to `$commit-pr-itest` or `$pr-merge-itest` as appropriate.
