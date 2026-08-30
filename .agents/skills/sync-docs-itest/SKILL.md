---
name: sync-docs-itest
description: Synchronize iTestAgent specifications, architecture, planning, ADRs, and deferred-item tracking after an approved change or decision.
---

# Synchronize iTestAgent documentation

1. Establish the approved behavior or decision and inspect the actual code/diff or newest relevant ADR. Do not infer a decision from timestamps alone when multiple changes are plausible.
2. Use `docs/INDEX.md` to identify every affected source of truth: user stories/AC, architecture, technical selection, data flow, implementation risks, AI-native workflow, planning, verification, ADRs, and `AGENTS.md`.
3. Preserve ownership boundaries:
   - `task-status.json` contains task tracking only;
   - `deferred-items.json` retains every item and audit history;
   - major technical or requirement decisions go in `docs/decisions/`;
   - verification claims require evidence in `docs/06-verification/`.
4. Quote and compare the prior authoritative constraint before changing it. Stop if the requested change conflicts with another source and no approved decision resolves the conflict.
5. Make the smallest consistent set of documentation changes. Project documents under `docs/` may remain Chinese; external-facing version-control content outside `docs/` must follow R12.
6. Resolve a deferred item only when the fix is proven; set `resolved_by` and preserve the item.
7. Re-scan for stale terminology, paths, task counts, command syntax, and cross-document contradictions.
8. Report every modified source of truth, the reason, and any unresolved ambiguity. Run relevant document/schema checks when available.
