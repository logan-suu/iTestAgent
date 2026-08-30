---
name: pr-review-itest
description: Review an iTestAgent pull request against AC, architecture, R1-R14, quality gates, and existing reviewer comments, then triage verified findings.
---

# Review an iTestAgent PR

Do not modify code or GitHub state when the user asked only for a review report. Apply fixes, replies, resolves, or comment minimization only when explicitly included in the request.

1. Identify the PR and compare it with `dev-1.0`. Read the changed files, related task, required documents, applicable AC, CI state, commits, and comments.
2. Review for R1-R14, layer direction, backend boundaries, schema/data-flow parity, abort propagation, permission gates, silent degradation, secret exposure, English external content, and required G5/G5-SIM evidence.
3. Verify every automated or human review claim against the current code before accepting it. Do not fix a finding based only on comment text.
4. Report actionable findings first, ordered by severity, with exact file/line, evidence, violated rule/AC, impact, and a minimal correction. State explicitly when no findings remain.
5. For each verified finding, decide:
   - fix now when it is safely within the PR scope;
   - defer only for an external dependency, cross-phase coordination, or disproportionate risk/scope;
   - reject as false, obsolete, duplicate, or off-topic with evidence.
6. When authorized to fix, make the smallest correction, run relevant tests plus typecheck/lint, push it, reply in English, and resolve the thread only after the fix is available remotely.
7. For necessary deferrals, add a complete immutable entry to `docs/05-planning/deferred-items.json`, reply `Deferred` with its DEF ID in English, and preserve the original comment URL/context.
8. Minimize or resolve invalid comments only when authorized and supported by evidence. Lack of permission is not a reason to invent success.
9. If the reviewed task is the phase integration task, audit all open deferred items targeting that phase and report which remain open or were resolved.
10. End with a merge-readiness conclusion and the exact checks performed. Never merge the PR.
