---
name: test-unit-itest
description: Run and analyze iTestAgent unit tests for a task or supplied test path, including typecheck and lint, without changing code unless requested.
---

# Run iTestAgent unit checks

1. Read task status and identify the supplied task/test path; otherwise use the current `in_progress` task.
2. Resolve unit-test paths from the task's `test_file` and `packages/<package>/test/*.test.ts`. Report when no unit test is registered.
3. Run `bun run typecheck`, `bun run lint`, and the narrowest relevant `bun test` command. Run the full suite when required by risk or explicitly requested.
4. Report command, duration, pass/fail/skip counts, and failing test names.
5. For failures, inspect the implementation, test, fixture, and applicable AC before classifying the cause as product regression, stale test, environment limitation, or inconclusive.
6. Do not weaken assertions, add mocks, skip tests, or modify code merely to make the suite green. Diagnose only unless the user requested a fix.
7. Do not change task status based solely on a test run. Recommend `$commit-pr-itest` only when the complete required gates are satisfied.
