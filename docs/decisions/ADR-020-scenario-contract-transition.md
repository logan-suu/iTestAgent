# ADR-020: Scenario Contract Transition — Generic Core First, Scenario Packs Later

- **Status**: Accepted
- **Date**: 2026-08-25
- **Decider**: Project owner (single developer), via promotion guide §9 directive
- **Related**: Promotion guide §9 (Scenario 边界与分阶段过渡), §6.2 (先泛化再迁移), §11.3/§11.4; ADR-001 (de-risk MVP); ADR-005 (pluggable backend architecture); AGENTS.md R4/R5/R11

## Context

The pre-promotion codebase mixed generic test-execution contracts with
product-specific scenario identity (e.g. Feed Memory / memory-profile
fixtures, product locators, fixed calibration constants). Promoting those
bytes verbatim would ship an "iTestAgent" whose public contracts are coupled
to one private app — the opposite of the guide's target posture: a generic,
project-aware iOS testing agent where scenario knowledge is pluggable.

At the same time, the v2 runtime field vocabulary (`itestagent.test-plan.v2`,
`itestagent.result.v2` style schemaVersions and their persisted shapes) is
already written by the live TUI/engine pipeline. A big-bang rename across all
eight workspace packages would break the only verified end-to-end path for a
cosmetic gain, violating the de-risk principle (ADR-001) and R8.

## Decision

Adopt the guide §9 Stage 1 boundary, recorded here as the durable decision:

1. **Generic core keeps execution semantics.** `itestagent-contracts`
   root-level modules retain only target execution, profiling services, run
   identity, typed outcomes, cleanup, report/evidence vocabulary. B04's
   TestPlan/target-execution slice (`test-plan.ts`, `test-plan-validation.ts`,
   `mvp-execution.ts`, `physical-mvp.ts`) adds no scenario symbols.
2. **Scenario contracts move behind a subpath.** Scenario-specific schemas
   belong in `packages/itestagent-contracts/src/scenarios/**`, exported only
   via the `itestagent-contracts/scenarios` subpath (authored in B05); the
   root barrel never re-exports scenario symbols.
3. **No cross-eight-package rename of v2 runtime fields in this transition.**
   The canonical v2 shapes stay authoritative; behavior preservation across
   the transition is the job of adapters/readers:
   - B37 later adds read-v2 migrations + registry shadow-read
     (guide §9 Stage 2A);
   - B36 switches the writer to v3 with compile-time registration after the
     differential tests go green (guide §9 Stage 2B).
   Until then, unknown/lossy inputs must fail as typed errors, never be
   silently rewritten (R5; guide §10 migration table).
4. **Published generic schemas stay scenario-free.** `schemas/*.schema.json`
   describe the generic core only; scenario schemas get their own
   `schemas/scenarios/**` files in B05/B36.
5. **Physical MVP identity stays injection-only.** Per guide §6.2, team/
   device/app identity enters through explicit inputs
   (`PhysicalIdentitySchema`); authorization, fingerprint, and signing facts
   remain memory-only (R6/R7). Route C/B pairing is locked by
   `validatePhysicalMvpContract` per ADR-012's G5 update.

## Consequences

- The root barrel and published schemas are safe to publish generically;
  downstream consumers cannot accidentally import scenario logic.
- B05 (scenario subpath), B37 (shadow-read migrations), and B36 (write-v3)
  have a recorded anchor to point back to instead of re-litigating scope.
- The temporary cost: two vocabularies (generic core vs. scenario packs)
  coexist during W3–W12; differential tests in B36 close the gap.
- If the project later drops scenario packs entirely, this ADR's subpath
  boundary makes removal a package-local operation.

## References

- Promotion guide §9 (Scenario 边界与分阶段过渡), §10 (持久化迁移设计)
- ADR-001 (de-risk MVP), ADR-005 (pluggable backends), ADR-012 (WDA lifecycle separation + G5 update)
