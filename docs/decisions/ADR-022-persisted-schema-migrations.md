# ADR-022: Persisted Schema Migrations

- **Status**: Accepted
- **Date**: 2026-08-26
- **Decider**: Project owner (single developer), via promotion guide §9 Stage 2A directive
- **Related**: Promotion guide §9 (Scenario 边界), §10 (持久化迁移设计); ADR-020 (scenario contract transition)

## Context

Persisted documents (config / result / artifact-index / test-plan) carry
schemaVersions that evolve. The promotion guide §10 mandates a pure-function
migration API — `unknown bytes → ParsedLegacy | Canonical | MigrationIssue` —
so old persisted variants can be read without in-place rewrites.

## Decision

1. Migration API is pure functions (never write on read; unknown/lossy input
   returns a typed MigrationIssue).
2. Migrations live in `itestagent-contracts/src/migrations/**`, exported via
   the `itestagent-contracts/migrations` subpath (root barrel exports only
   generic migration types, never scenario symbols — ADR-020).
3. Shadow-read (registry-shadow-read) compares the v2 adapter against a
   candidate reader, canonicalized and differential — it never switches flow
   or writes disk (guide §9 Stage 2A).
4. The `./migrations` exports-map change is dependency-free; the lock file is
   verified byte-identical by the B37 LOCK_INVARIANT gate.

## Consequences

- Report validator and run-store can read legacy persisted documents via the
  compatibility readers.
- Canonical writers (B07-style) stay the only write path.
- The full v3 compile-time registry lands in B36 on top of this foundation.

## References

- Promotion guide §9 Stage 2A, §10; ADR-020 (scenario contract transition)

## 迁移同步（B39）

本 ADR 由 B37 落地：migrations 子路径导出 + LOCK_INVARIANT 门禁通过（lock byte-identical）。
