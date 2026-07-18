# PR Review Deferred Items

> Centralized registry for CodeRabbit / reviewer comments deferred to future phases.
> Each item links to its source (PR number, comment ID) and target phase.

**Last updated**: 2026-07-18

---

## Active Deferred Items

| # | PR | Source | Comment ID | Severity | Description | Target Phase | Status |
|---|---|---|---|---|---|---|---|
| 1 | [#11](https://github.com/logan-suu/iTestAgent/pull/11) | CodeRabbit W2 | `3608463027` | 🟠 Major | Unify `store-driver.ts` + `db.ts` connections into single factory to prevent `SQLITE_BUSY` in transaction callbacks | Phase 3 (3.2 mock backend) | ⏳ pending |
| 2 | [#11](https://github.com/logan-suu/iTestAgent/pull/11) | CodeRabbit W7 | `3608463035` | 🟡 Minor | Add proper transaction isolation test using driver-managed shared connection handle | Phase 3 (3.2 mock backend) | ⏳ pending |

---

## Resolved / Completed

*(items move here once the fix is implemented in the target phase)*

---

## Workflow

When a reviewer comment is **reasonable but cannot be fixed in the current PR**:

1. Add an entry to the Active table above
2. Reply to the comment explaining deferral reason and linking to this file
3. Resolve the conversation

When the target phase task is executed:
1. Check this file for items targeting that phase
2. Implement the fixes
3. Move the row from Active → Resolved
