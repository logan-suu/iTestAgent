---
name: pr-merge-itest
description: Verify completion of an iTestAgent code or non-code task after explicit human confirmation and update task tracking without automatically merging a PR.
---

# Confirm task completion

The agent must never merge a PR. A code task becomes `done` only after the user confirms that a human merged its PR into `dev-1.0`. A non-code task becomes `done` only after the user explicitly approves its deliverable.

1. Locate the `in_progress` task and classify it from its notes as code/PR or non-code/report. Ask when classification is ambiguous.
2. For code tasks, inspect the PR, CI, mergeability, quality gates, required G5/G5-SIM evidence, and target branch. If it is not yet merged, provide a readiness report and stop for the human merge.
3. After explicit confirmation, independently verify that the PR is merged into `dev-1.0`; do not rely solely on the statement when GitHub state is accessible.
4. For non-code tasks, present the deliverable path and conclusion, then require explicit approval before continuing.
5. Before updating state, require a clean or safely separable working tree. Update the task to `done`, timestamp it, and append an English confirmation note.
6. If the task is the phase's `integration_test`, review every open deferred item targeting that phase. Mark only proven fixes `resolved`; never delete entries.
7. Cascade newly unblocked tasks from `pending` to `ready`, and advance phase state/current phase only when its documented exit conditions are satisfied.
8. Any commit or push of the tracking update requires explicit user authorization and must follow R12. Never run `gh pr merge`.
