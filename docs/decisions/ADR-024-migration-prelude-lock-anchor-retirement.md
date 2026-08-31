# ADR-024: Migration Prelude Lock-Anchor Retirement

- **Status**: Accepted
- **Date**: 2026-08-30
- **Decider**: Project owner (single developer), confirmed in session
- **Related**: promotion-plan-approval.json (B00-B42), ADR-023, PR #62-#68

## Context

The promotion plan approval (B00-B42) pinned `targetBunLockSha256=332573df…`
to guarantee migration batches did not drift from the approved plan. The
migration completed in August 2026: all 43 batches merged (PR #62-#68), the
G5 real-device interaction loop verified (element tap → assertion PASSED on
iPhone 14 Plus), and G1-G7 gates enforced per batch.

PR #64-#68 legitimately added dependencies (engine → build-xcodebuild /
analyzer-xcresult / device-appium), moving the lock to `c86cd849…`. The
prelude's pinned-lock check (verify-bun-binary.sh) now fails against the
frozen approval anchor, blocking every prelude-gated commit — including
normal Phase 7 optional enhancement work.

## Decision

1. The migration period is CLOSED. The approval file is frozen as a
   historical record — its lock anchor is never refreshed in place.
2. verify-bun-binary.sh skips the lock SHA check when the approval carries
   no anchor (fail-open on absence, fail-closed on a present-but-mismatched
   anchor for any future re-approval).
3. Dependency changes are governed by the standard gates: G1-G7, CodeRabbit,
   allowed-edges architecture tests, full test suite.

## Consequences

- Phase 6 dependency changes no longer require approval-file updates.
- The prelude's other protections (pinned Bun binary verification, receipt
  gates, gitleaks) are unchanged.
- If a future promotion-style batch is ever needed, re-approve with a fresh
  anchor (fail-closed on mismatch remains for that path).
