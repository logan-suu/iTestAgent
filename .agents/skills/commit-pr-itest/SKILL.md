---
name: commit-pr-itest
description: Run iTestAgent pre-commit gates, create a compliant feature branch and commit, push it, open a PR to dev-1.0, and record the PR while keeping the task in progress.
---

# Commit and open an iTestAgent PR

Use this workflow only when the user explicitly asks to commit or create the PR. Never merge the PR.

1. Read `AGENTS.md`, task status, deferred items, Git status, the current branch, and the complete diff.
2. Stop if there are no changes, if the current task cannot be identified, or if unrelated user changes cannot be safely separated.
3. Check every review/self-review finding. Fix in-scope findings now; record only genuinely deferred findings in `deferred-items.json` with complete context. Use `source: "Codex (self-review)"` for new self-review items.
4. Verify G1-G7 and G5-SIM applicability. At minimum run `bun run typecheck`, `bun run lint`, and `bun test`; preserve evidence required by the repository Git hooks.
5. Scan the diff for secrets, private data, generated artifacts, and forbidden external-facing non-English content under R12.
6. If on `main` or `dev-1.0`, create a `{type}/{english-kebab-description}` branch. Do not create a branch earlier in the workflow.
7. Create an English commit using:

   ```text
   {type}({scope}): {subject}

   {body}

   Related: US-X.Y
   ```

8. Push the feature branch and create an English PR with base `dev-1.0`. Include an implementation summary, verification evidence, risks/limitations, and an AC coverage table.
9. Update the current task's notes with the PR URL and summary, update its timestamp, and keep `status: "in_progress"`. Commit and push that status update only when it belongs in the same feature branch/PR.
10. Report the branch, commit, PR URL, checks, and any deferred items. Do not mark the task `done`.
