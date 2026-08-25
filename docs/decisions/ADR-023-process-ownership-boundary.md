# ADR-023: Process Ownership Boundary (itestagent-process Leaf)

- **Status**: Accepted
- **Date**: 2026-08-25
- **Decider**: Project owner (single developer), via promotion guide §8.1 directive
- **Related**: Promotion guide §8 (target architecture), §8.1, §11.4; ADR-010 (agent harness runtime boundary); AGENTS.md R10/R11

## Context

The pre-promotion codebase owned subprocess lifecycle management
(`SubprocessController`: spawn / TERM→KILL escalation / abort propagation /
leader identity / reaping) inside `itestagent-server`. This placement creates a
dependency cycle at the architecture level:

```
itestagent-engine → device-appium → itestagent-server → itestagent-engine
```

`device-appium` needs to spawn and supervise long-lived child processes
(Appium server, WDA, xctrace recording, xcodebuild), but the only home for the
spawn/kill/reap primitives was the server package — which itself depends on
the engine. Any backend that imports process ownership from the server is
pulled into the engine→server cycle.

Process ownership is not an orchestration concern. It is a low-level OS
capability: given a command, own its lifetime (SIGTERM → grace deadline →
SIGKILL), record who the leader is (pid), reap its exit, and never orphan it.
Per the promotion guide §8 target graph, this belongs in a leaf that only
touches Bun/OS process APIs:

> `itestagent-process` → Bun/OS process APIs；不得依赖任何 internal workspace package。
> `device-appium` → `itestagent-process`；不得指向 `itestagent-server`。

## Decision

1. **Extract** the subprocess controller and owned process group management
   from `itestagent-server` into a new leaf package
   `packages/itestagent-process` with **zero internal workspace
   dependencies**. The package may depend only on Bun/OS process APIs (and,
   if ever needed, external npm libraries — none are required today).
2. **Split by concern**, preserving behavior verbatim:
   - `subprocess-types.ts` — `SignalName`, `ExitInfo`, `SubprocessOptions`,
     `SubprocessHandle`.
   - `subprocess-spawn.ts` — low-level child start (Bun.spawn invocation).
   - `owned-process-group-system.ts` — system API adapters (safe env
     whitelist, raw exit-code decoding, signal delivery).
   - `owned-process-group-identity.ts` — leader identity (pid captured at
     ownership acquisition, stable across exit).
   - `owned-process-group-cleanup.ts` — cleanup deadlines (grace SIGKILL
     fallback timer, timeout auto-kill timer).
   - `owned-process-group-reaping.ts` — exit reaping (raw exit → `ExitInfo`).
   - `owned-process-group.ts` — per-process ownership composition
     (TERM→KILL chain, abort hookup, idempotent kill, liveness).
   - `subprocess-controller.ts` — the public `spawn()` controller facade.
3. **Remove the server exports permanently**: `itestagent-server/src/index.ts`
   drops `spawn`, `SubprocessHandle`, `SubprocessOptions`, `ExitInfo`, and
   `SignalName`. There is **no compatibility re-export**, permanent or
   temporary; consumers import from `itestagent-process` directly.
4. **device-appium dependency direction**: `itestagent-backends-device-appium`
   may declare an explicit dependency on `itestagent-process` (wired in its
   own batch). It must never depend on `itestagent-server`. The edge
   `itestagent-backends-device-appium → itestagent-process` is the only
   allowed inbound edge to the leaf (`tests/architecture/allowed-edges.json`).
5. **Lock serialization**: adding the workspace package regenerates
   `bun.lock` in the same commit (guide §11.4 lists B06 as a lock
   serialization point).

## Consequences

- The engine→device-appium→server→engine cycle is broken at the
  server-as-process-owner link: backends can own child processes without
  reaching into the server or the engine.
- `itestagent-server` shrinks to session/SSE/route concerns; its public
  surface loses the subprocess exports in the same commit as the move (no
  deprecation window, per guide §8.1).
- All existing consumers found at extraction time
  (`tests/integration/phase1/phase1-subprocess-lifecycle.test.ts`) are
  migrated in the same commit; no other production consumer existed.
- Behavior is preserved: this is a move plus concern-split, not a rewrite.
  Signatures, defaults (5s grace), env whitelisting (R6), TERM→KILL
  escalation, abort idempotency, and exit decoding are unchanged and covered
  by the migrated test suite plus new concern-scoped tests.
- Future batches must keep the leaf dependency-free; the dependency-graph
  gate enforces zero internal deps and the single inbound edge.
