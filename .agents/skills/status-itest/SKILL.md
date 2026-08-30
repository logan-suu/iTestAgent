---
name: status-itest
description: Report the current iTestAgent phase, task progress, deferred items, milestone, and Git branch without changing repository state.
---

# Report iTestAgent status

This workflow is read-only.

1. Read `docs/05-planning/task-status.json` and `docs/05-planning/deferred-items.json`.
2. Use `docs/INDEX.md` to locate and read the current phase milestone in the planning documentation.
3. Inspect the current Git branch and working-tree status.
4. Report:
   - current phase name and phase status;
   - completed and total task counts with a percentage;
   - current-phase counts for `done`, `in_progress`, `ready`, and `pending`;
   - all `in_progress` tasks, otherwise the first ready task;
   - the count and concise list of open deferred items for the current phase;
   - current milestone exit criteria, branch, dirty/clean state, and last update timestamp.
5. Do not cascade statuses or edit any file as part of a status request.
