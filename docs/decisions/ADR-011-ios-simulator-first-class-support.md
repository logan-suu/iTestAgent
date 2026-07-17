# ADR-011: iOS Simulator First-Class Support

**Status**: Accepted
**Date**: 2026-07-17
**Deciders**: Logan Su (solo developer)
**Replaces**: ADR-003 (partial), ADR-005 (extended), ADR-006 (extended), ADR-010 (extended)

---

## Context

iTestAgent was initially scoped as "Real-device only." The product boundary, architecture, contracts, task plan, and quality gates all assume physical iPhone as the sole execution target.

Adding iOS Simulator support is not a minor backend addition — it changes the product scope, governance model, schema contracts, build targets, device discovery, orchestration, performance semantics, quality gates, and task schedule.

## Decision

### 1. Unified DeviceBackend + TargetKind

iOS Simulator is a **first-class execution target**, not a test-only convenience. Physical iPhone and iOS Simulator share the same `DeviceBackend` interface; the distinction is captured by a `TargetKind` discriminant:

```
TargetKind = 'physical' | 'simulator'
```

No separate `SimulatorBackend` interface. The existing `DeviceBackend` is the single stable abstraction for device operations.

### 2. Appium as Default for Both Target Kinds

`AppiumDeviceBackend` (implementing `DeviceBackend`) supports both `physical` and `simulator` target kinds:

- **Physical**: `devicectl/xcodebuild` + Appium/WDA
- **Simulator**: `simctl/xcodebuild` + Appium/WDA

Appium is the **current default tool**, not a project-level dependency. It can be replaced independently per target kind without modifying AgentRuntime, ToolDispatcher, RunStateMachine, TestPlan, Flow, or report generators.

### 3. BackendCapabilities Extended

```typescript
interface BackendCapabilities {
  supportedTargetKinds: Array<'physical' | 'simulator'>;
  features: string[];
  supportsUiTree: boolean;
  supportsScreenshot: boolean;
  supportsVideo: boolean;
  supportsCrashLogs: boolean;
  supportsLocation: boolean;
  supportsPush: boolean;
}
```

### 4. BackendSelector — Single Selection Component

Input: `targetKind`, explicit preference, required capabilities, healthcheck, permission/fallback policy.
Output: selected `DeviceBackend`, selection reason, fallback history.

No internal `ProviderRegistry`. No two-layer selection.

### 5. Per-Target Backend Preference

```jsonc
{
  "device": {
    "preferredBackends": {
      "physical": ["appium", "mobile-mcp"],
      "simulator": ["appium"]
    },
    "allowCrossTargetFallback": false
  }
}
```

Same target kind: fallback through preference list.
Cross target kind: requires user confirmation (`ask`). Never silent.

### 6. Baseline Domain Isolation

Physical and simulator baselines are strictly separated:

```
physical baseline ↔ physical run
simulator baseline ↔ simulator run
cross-domain comparison → rejected at Schema/Store layer
```

Simulator reports must carry `environment = simulator`, `representativeOfPhysicalDevice = false`, `comparisonScope = simulator_only`.

### 7. Quality Gates

- **G5** (existing): Physical device capability must be verified on a real iPhone.
- **G5-SIM** (new): Simulator capability must be verified on a real CoreSimulator runtime end-to-end.

Capabilities claiming both target kinds must pass **both** G5 and G5-SIM.

### 8. Schema Version

Contracts (test-plan, result, flow) upgrade to v2. Historical v1 data is migrated as `targetKind=physical`. New writers MUST NOT produce documents without `targetKind`.

### 9. Exclusions

- `idb` — excluded (uses Xcode private frameworks, violates R1)
- `ios-simulator-mcp` UI path — excluded (depends on `idb`, violates R1)
- Detox — excluded (React Native only)
- Separate `SimulatorBackend` interface — not adopted (duplicates `DeviceBackend`)
- Internal `SimulatorUiAutomationProvider` port — not adopted (duplicates `DeviceBackend`)

## Consequences

### Positive
- Simulator and physical device share the same user experience (CLI/TUI, TestPlan, Flow, report)
- `TargetKind` is small and orthogonal to existing interface
- Backend implementations are independently replaceable per target kind
- Baseline isolation prevents misleading performance comparisons

### Negative
- ~7-10 person-weeks of additional work distributed across phases
- All existing "Real-device only" language must be updated
- Schema v2 migration adds complexity
- G5-SIM doubles the spike/verification burden for dual-target features

### Risk Mitigation
| Risk | Mitigation |
|---|---|
| Real-device-only documentation drift | ADR-011 precedes all changes; SSoT updated first |
| Simulator performance misinterpretation | Schema/Store baseline domain isolation; report annotations |
| G5 replaced by Simulator testing | G5 retained; G5-SIM is additional, not a substitute |
| Appium/WDA Xcode coupling | Version lock; re-run G5-SIM on each Xcode update |
| Parallel port/DerivedData conflicts | SessionManager manages unique resources and cleanup |

## References

- ADR-005: Pluggable Backend Architecture
- ADR-006: Device Backend Evaluation (Appium/WDA as primary)
- ADR-010: Agent Harness Runtime Boundary
- Architecture Design Document §5 (Backend Interfaces)
- Implementation Guide §3 (Real Device / Signing / Backend)
- [iOS Simulator Support Technical Report](../06-verification/ios-simulator-support-report.md)（如已产出）
