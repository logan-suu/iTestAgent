---
name: read-spec-itest
description: Read and summarize the authoritative iTestAgent specification and architecture constraints for a task without implementing changes.
---

# Read task specifications

This workflow is read-only.

1. Read `AGENTS.md`, `docs/INDEX.md`, and `docs/05-planning/task-status.json`.
2. Use a user-supplied task ID; otherwise prefer an `in_progress` task, then the first `ready` task in `current_phase`.
3. Read every path in the task's `documents_required` field and the exact user-story section when `story` is present.
4. Use `docs/INDEX.md` to locate only directly relevant architecture, data-flow, implementation-risk, verification, and ADR sections.
5. Quote applicable AC text and architecture constraints verbatim.
6. Report the task, story, dependencies, AC, required contracts, R1-R14 constraints, verification obligations, and source paths.
7. Clearly label anything not directly established by project documentation. Stop and request a decision when sources conflict or are ambiguous.
8. Do not write code or change task status.
