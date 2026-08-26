# ADR-021: Engine → device-appium Edge

- **Status**: Accepted
- **Date**: 2026-08-26
- **Decider**: Project owner (single developer), via promotion guide §11.3 directive
- **Related**: Promotion guide §11.3 (engine target execution), ADR-010 (agent harness runtime boundary), ADR-012 (WDA lifecycle separation)

## Context

B15 (engine target execution) lets the engine orchestrate physical/simulator
MVP runs. The engine composes the B13 device-appium process/session/WDA
handles (appium-process-manager, appium-session-lifecycle, owned-wda-processes)
and the B12 build-xcodebuild lanes. This adds a workspace dependency edge
from `itestagent-engine` to `itestagent-backends/device-appium`, which must be
recorded in the architecture dependency-graph allowlist so the G4b edge gate
accepts it.

## Decision

1. `itestagent-engine` depends on `itestagent-backends/device-appium`
   (`workspace:*`) solely for the device-handle vocabulary and lifecycle
   wrappers — never to reach into Appium internals.
2. The dependency-graph allowlist (`tests/architecture/allowed-edges.json`)
   records the new edge.
3. Engine-side orchestration stays thin: the run coordinator composes
   injected adapters/cleanup rather than managing subprocesses directly
   (ADR-010: AgentRuntime never executes device commands itself).

## Consequences

- The engine can drive a physical MVP run without re-implementing process or
  session management.
- The dependency-graph gate stays honest about the new edge.
- If a future backend replaces device-appium, only the adapter layer changes;
  the coordinator surface is backend-neutral.

## References

- ADR-010 (agent harness runtime boundary), ADR-012 (WDA lifecycle separation)
