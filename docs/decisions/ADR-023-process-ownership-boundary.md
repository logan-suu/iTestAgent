# ADR-023: Process Ownership Boundary

- **Status**: Accepted
- **Date**: 2026-08-26
- **Decider**: Project owner (single developer), via promotion guide directive
  (B06 companion — recorded with B39 docs-truth per guide §11.3)
- **Related**: ADR-012 (WDA lifecycle), B06 (process leaf), B35 (phase5 PTY
  race), ADR-010 (harness boundary)

## Context

Long-running child processes (WDA, Appium, xctrace, simctl, AUT) need
unambiguous ownership and teardown boundaries so a failed or aborted run
never leaks processes. The promotion guide requires this decision to be
recorded before the process package move lands.

## Decision

1. Each backend owns the child processes it spawns; there is no
   cross-backend process handoff.
2. Teardown order is fixed: recorder → appium → aut → wda (memory-profile
   runtime cleanup).
3. PTY / bounded-child races are absorbed at the harness boundary (B35) via
   the bounded-child probe and a PTY cleanup deadline.
4. Cycle-break: the engine never spawns device processes directly — all
   device command execution goes through the DeviceBackend interface
   (ADR-010 harness boundary).

## Consequences

- Process lifecycle is deterministic and attributable to a single owner.
- Abort propagates via AbortSignal / Bun.spawn (B06 process leaf).
- PTY pressure capacity is verified at the phase5 harness (B35).
