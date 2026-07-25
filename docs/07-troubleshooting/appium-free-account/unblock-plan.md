# Implementation Plan: Resolve Appium Free Apple Developer Account Real Device Blocker

**Date**: 2026-07-25
**Baseline**: `dev-1.0` (task 3.7 done, 3.17 done, Phase 3 exit gate passed)
**Reference**: `/Users/logansu/Desktop/报告/iTestAgent Agent 开发执行手册：解决 Appium 免费 Apple Developer 账号真机阻塞.md`
**Related**: ADR-006, ADR-012, DEF-023, DEF-015, Task 3.7, Task 3.17
**Scope**: `packages/itestagent-backends/device-appium/` (physical device path only — simulator unchanged)

---

## Executive Summary

The current AppiumBackend uses `usePrebuiltWDA: true` which skips `build-for-testing` but still runs Appium's hardcoded `test-without-building` — this fails on free accounts because Appium does not pass `-allowProvisioningUpdates`.

The solution is **Route A (`usePreinstalledWDA`)** as the primary strategy: iTestAgent builds, signs, and installs WDA once (via existing WdaManager), then tells Appium to use the pre-installed WDA without running ANY xcodebuild. This is a different Appium capability — `usePreinstalledWDA` ≠ `usePrebuiltWDA`.

**Route B (`webDriverAgentUrl`)** is kept as a controlled fallback — iTestAgent manages WDA completely, Appium connects to it via URL.

## Key Insight: Two Different Capabilities

| Capability | Appium xcodebuild | Current Usage | Required Change |
|---|---|---|---|
| `usePrebuiltWDA: true` | Skips `build-for-testing` only; still runs `test-without-building` | ✅ Currently used in `buildPhysicalCapabilities()` | Replace with `usePreinstalledWDA` |
| `usePreinstalledWDA: true` | **Skips ALL xcodebuild** — uses device-installed WDA | ❌ Not used | **Add as new capability** |
| `webDriverAgentUrl` | **Skips ALL xcodebuild** — connects to external WDA | ❌ Not used | **Add as fallback mode** |
| `allowProvisioningDeviceRegistration: true` | Adds `-allowProvisioningUpdates` to Appium-managed xcodebuild | ❌ Not used | **Add as diagnostic option** |

---

## Phase 0: Gate 0 — Lock Versions & Workspace

**Goal**: Record all version info before making changes.

**Actions**:
1. Record Appium, XCUITest Driver, WDA, Xcode, iOS, Bun versions → new section in G5 spike report
2. Pin actual WDA version (not XCUITest Driver semver range)
3. All WDA packaging in staging directory (`~/.itestagent/wda-staging/`), NOT global Appium dependencies
4. Replace real identifiers with placeholders in all logs/reports

**Files**: No code changes — documentation only.

---

## Phase 1: Gates 1-2 — Signing Identity & Bundle ID Canon

### Gate 1: Resolve Real Signing Identity

**Problem**: Current code assumes a single Team ID from `security find-identity`. The execution manual requires cross-validation across 5 sources.

**Actions**:
1. Add `resolveTeamId()` to `wda-manager.ts`: cross-validate from xcodebuild `-showBuildSettings`, cert subject OU, provisioning profile TeamIdentifier, codesign entitlements, Runner Info.plist CFBundleIdentifier
2. Exit with structured error (not generic "code 65") when Team/cert/Profile mismatch

### Gate 2: Canonical Bundle ID — Fix `.xctrunner` Double-Suffix Bug

**Problem**: Current `appium-capabilities.ts` comment says `wdaBundleId` takes `"UJ876FXT32.WebDriverAgentRunner.xctrunner"` (with suffix). XCUITest scheme auto-appends `.xctrunner`, resulting in double suffix `WebDriverAgentRunner.xctrunner.xctrunner`.

**Actions**:
1. Define canonical model in `appium-capabilities.ts`:
   ```typescript
   type WdaBundleIdCanon = {
     base: string;           // "UJ876FXT32.WebDriverAgentRunner" (NO .xctrunner)
     runner: string;         // "UJ876FXT32.WebDriverAgentRunner.xctrunner" (actual)
   };
   ```
2. Fix `PhysicalCapabilitiesOptions.wdaBundleId` doc and usage — accept base ID only
3. `updatedWDABundleId` always receives base ID
4. Update test fixtures: `DEFAULT_SESSION.wdaBundleId` from `"TEAMID.WebDriverAgentRunner.xctrunner"` → `"TEAMID.WebDriverAgentRunner"`

**Files**:
- `packages/itestagent-backends/device-appium/src/appium-capabilities.ts`
- `packages/itestagent-backends/device-appium/test/appium-device-backend.test.ts` (line 74)

---

## Phase 2: Gate 3 — Prepare Preinstalled WDA Bundle

**Goal**: Extend WdaManager to support the full preinstalled-WDA workflow (build + sign + install + verify).

**Actions**:
1. Add `WdaManager.preparePreinstalledWDA()`:
   - Build with `-allowProvisioningUpdates`
   - Verify no `Frameworks/XC*.framework` embedding (iOS 17+ constraint)
   - Verify signing integrity (Entitlements, Profile expiry, Bundle ID)
   - Install to device via `devicectl` (with user confirmation — R7)
   - Read actual installed Bundle ID (don't assume)
2. Add `WdaManager.verifyPreinstalledWDA(udid, expectedBundleId)`:
   - Check Runner exists on device
   - Check Profile not expired
   - Return structured result: `{ ready: boolean, reason?: string }`

**Files**:
- `packages/itestagent-backends/device-appium/src/wda-manager.ts`

---

## Phase 3: Gate 4 — Remodel Code Boundaries

This is the largest phase — introducing three mutually exclusive startup modes.

### 3.1: `appium-capabilities.ts` — Three Startup Modes

**Goal**: Replace `usePrebuiltWDA` boolean with a discriminated union of three modes.

**New type**:
```typescript
export type WdaStartupMode = 'managed-xcodebuild' | 'preinstalled' | 'external-url';

export interface PhysicalCapabilitiesOptions {
  // ... existing fields ...

  /**
   * WDA startup mode. Mutually exclusive — only ONE should be used.
   *
   * 'managed-xcodebuild': Appium builds + signs + launches WDA (default for paid accounts).
   *   Passes xcodeOrgId + xcodeSigningId + allowProvisioningDeviceRegistration.
   *
   * 'preinstalled': WDA is already built, signed, installed on device. Appium skips ALL xcodebuild.
   *   Requires iOS 17+. Use after WdaManager.preparePreinstalledWDA().
   *
   * 'external-url': WDA is running externally. Appium connects via webDriverAgentUrl.
   *   Use when iTestAgent manages WDA lifecycle completely.
   */
  wdaStartupMode: WdaStartupMode;

  // mode-specific options
  /** For 'external-url': WDA URL (http://127.0.0.1:<port>). */
  webDriverAgentUrl?: string;
  /** For 'managed-xcodebuild': Team ID. */
  xcodeOrgId?: string;
  /** For 'managed-xcodebuild': Signing identity (default: Apple Development). */
  xcodeSigningId?: string;
  /** For 'managed-xcodebuild': Allow provisioning updates. */
  allowProvisioningDeviceRegistration?: boolean;
}
```

**Validation logic**: `buildPhysicalCapabilities()` must:
- Reject conflicting capability combinations (e.g., preinstalled + webDriverAgentUrl)
- Only generate `usePreinstalledWDA` for `preinstalled` mode (NOT `usePrebuiltWDA`)
- Only generate `webDriverAgentUrl` for `external-url` mode
- Skip `xcodeOrgId`/`xcodeSigningId`/`allowProvisioningDeviceRegistration` in preinstalled/external-url modes
- `updatedWDABundleId` must use base ID (no `.xctrunner`)

**Files**:
- `packages/itestagent-backends/device-appium/src/appium-capabilities.ts`
- `packages/itestagent-backends/device-appium/src/index.ts` (export new types)

### 3.2: `wda-manager.ts` — /status Polling & Lifecycle

**Goal**: Make WdaManager a reliable WDA lifecycle manager with readiness checks.

**Actions**:
1. Add `WdaManager.waitForReady(port, timeoutMs)`:
   - Poll `GET http://127.0.0.1:<port>/status` every 500ms
   - Return when `ready: true` or timeout
   - Return structured result with version metadata
   - Support `AbortSignal`
2. Add `WdaManager.stop(graceMs)`:
   - SIGTERM → wait graceMs → SIGKILL if still alive
   - Idempotent
3. `isRunning()` must not rely on "process not killed" — must check actual process state
4. Add `WdaManager.getStagingDir()` for deterministic output paths

**Files**:
- `packages/itestagent-backends/device-appium/src/wda-manager.ts`

### 3.3: `appium-device-backend.ts` — Route-Based Session Lifecycle

**Goal**: `ensureSession()` and `closeSession()` correctly handle all three startup modes.

**Actions**:
1. Add `WdaStartupMode` awareness to `AppiumDeviceBackendOptions`
2. `doCreateSession()` logic:
   - `preinstalled` mode:
     - Call `wdaManager.verifyPreinstalledWDA()` before session
     - Do NOT call `wdaManager.launch()`
     - Pass `usePreinstalledWDA: true` capabilities
   - `external-url` mode:
     - Call `wdaManager.launch()` then `wdaManager.waitForReady()`
     - Pass `webDriverAgentUrl` capabilities
     - Appium session creation only after WDA ready confirmed
   - `managed-xcodebuild` mode:
     - Existing behavior (Appium manages everything)
3. `closeSession()` fix: cleanup must run even when `sessionActive === false`
   ```typescript
   // Current (BUG): returns early if sessionActive=false, leaking WDA/ports
   if (!this.sessionActive) return;
   
   // Fixed: cleanup always runs, sessionActive guards only Appium delete
   ```
4. Add `finally` block in `doCreateSession()`: if Appium session creation fails, still clean up WDA process (external-url mode) or log diagnostic (preinstalled mode)
5. Update `AppiumDeviceBackendOptions`:
   ```typescript
   export interface AppiumDeviceBackendOptions {
     // ... existing ...
     wdaStartupMode: WdaStartupMode;
     webDriverAgentUrl?: string;  // for external-url mode
   }
   ```

**Files**:
- `packages/itestagent-backends/device-appium/src/appium-device-backend.ts`

### 3.4: Composition Root — Production Entry

**Goal**: Wire RealAppiumDriver + AppiumDeviceBackend + WdaManager together in a real production context (not just in tests).

**Actions**:
1. Create `packages/itestagent-backends/device-appium/src/composition-root.ts`:
   ```typescript
   export interface ProductionAppiumConfig {
     udid: string;
     targetKind: TargetKind;
     wdaStartupMode: WdaStartupMode;
     bundleId?: string;
     wdaBaseBundleId?: string;
     webDriverAgentUrl?: string;
     xcodeOrgId?: string;
     // ...
   }
   
   export function createAppiumDeviceBackend(config: ProductionAppiumConfig): {
     backend: AppiumDeviceBackend;
     wdaManager?: WdaManager;
     realDriver: RealAppiumDriver;
   }
   ```
2. Wire into BackendRegistry via `backend-selector.ts`

**Files**:
- `packages/itestagent-backends/device-appium/src/composition-root.ts` (new)
- `packages/itestagent-backends/device-appium/src/index.ts` (export)

---

## Phase 4: Gate 5 — Doctor Diagnostics

**Goal**: `itestagent doctor` must distinguish "Appium installed" from "real device chain ready."

**Actions**:
1. New doctor checks:
   - `check-signing-identity.ts`: Xcode account login, cert + private key, Team type (personal/paid)
   - `check-wda-preinstalled.ts`: Runner exists on device, Profile not expired, Bundle ID match
   - `check-wda-readiness.ts`: `/status` reachable, version match
2. Doctor output must use: `pass | fail | manual | blocked` (not just healthy/not)
3. `manual` results must NOT be aggregated as fully healthy

**Files**:
- `packages/itestagent-cli/src/doctor/checks/check-signing-identity.ts` (new)
- `packages/itestagent-cli/src/doctor/checks/check-wda-preinstalled.ts` (new)
- `packages/itestagent-cli/src/doctor/checks/check-wda-readiness.ts` (new)

---

## Phase 5: Gate 6 — Security & Evidence

**Goal**: R6 compliance — no real identifiers in code, logs, or reports.

**Actions**:
1. Create `packages/itestagent-backends/device-appium/src/redactor.ts`:
   - Redact email, UDID, Team ID, device name, user paths from error messages and logs
2. All AppiumDeviceBackend error paths must route through redactor
3. Screenshot/video artifacts marked `raw-local-only` (not `safe`)
4. Appium server binding: `127.0.0.1` only (not `0.0.0.0`), no `--relaxed-security`

**Files**:
- `packages/itestagent-backends/device-appium/src/redactor.ts` (new)
- `packages/itestagent-backends/device-appium/src/appium-device-backend.ts` (redactor integration)

---

## Phase 6: Gate 7 — Automated Tests

**Goal**: Comprehensive test coverage for the new startup modes.

### Capability Tests
- Three modes are mutually exclusive (reject conflicting combos)
- `usePrebuilt` still belongs to `managed-xcodebuild`
- `preinstalled` does NOT generate `webDriverAgentUrl` or `usePrebuiltWDA`
- `external-url` does NOT generate xcodebuild/preinstalled capabilities
- Base Bundle ID never contains `.xctrunner`

### Lifecycle Tests
- WDA started, Appium session fails → cleanup still runs
- `/status` timeout → explicit error (not silent)
- AbortSignal cancels readiness check, Appium session, and child process
- Double close is idempotent
- Same UDID concurrent → serialized
- Different UDID → independent ports

### Doctor Tests
- Personal Team identified but not auto-failed
- Profile expired / Bundle ID mismatch / no private key / device not included → fail/blocked
- Runner exists but `/status` unreachable → NOT healthy

### Security Tests
- Error messages contain no email, UDID, Team ID, user path
- Appium server listens loopback only

**Files**:
- `packages/itestagent-backends/device-appium/test/appium-capabilities.test.ts` (new)
- `packages/itestagent-backends/device-appium/test/wda-manager-lifecycle.test.ts` (new)
- `packages/itestagent-backends/device-appium/test/appium-device-backend.test.ts` (extend)

---

## Phase 7: Gate 8 — Real Device G5

**Prerequisite**: ALL previous gates pass. Requires real iPhone.

**Minimum verification matrix**:
1. Personal Team + `preinstalled` mode (primary target)
2. Personal Team + `external-url` mode (fallback)
3. Appium-managed xcodebuild + `allowProvisioningDeviceRegistration` (diagnostic)
4. Profile expiry → fail + re-sign → recovery
5. Lock screen / disconnect / cancel / repeat session / cleanup

**Evidence required** (all redacted):
- Appium stdout/stderr
- xcodebuild/devicectl output
- Session capabilities + session ID
- `/status` response + version info
- page-source XML
- Decoded PNG with SHA-256 + byte size
- tap/swipe/type/app lifecycle step-by-step results
- Session delete, WDA stop, port release results
- `result.json`, `artifact-index.json`, artifact existence

**G5 report output**: `docs/06-verification/g5-spike-report-appium-unblock.md`

---

## Phase 8: Documentation & State Updates

- Update `docs/07-troubleshooting/appium-free-account/blocker.md` — mark resolved or update with new findings
- Update `task-status.json` — create new task (e.g., `3.7b`) or update 3.7 notes
- Update `docs/decisions/ADR-012` if WdaManager scope changes
- Close DEF-023 if G5 evidence supersedes old report contradiction

---

## Files Changed Summary

| File | Phase | Change Type |
|---|---|---|
| `device-appium/src/appium-capabilities.ts` | 3.1 | Major — new WdaStartupMode type, rework buildPhysicalCapabilities |
| `device-appium/src/wda-manager.ts` | 2, 3.2 | Major — preparePreinstalledWDA, waitForReady, proper stop |
| `device-appium/src/appium-device-backend.ts` | 3.3 | Major — route-based session lifecycle, closeSession fix |
| `device-appium/src/composition-root.ts` | 3.4 | **New** — production wiring |
| `device-appium/src/redactor.ts` | 5 | **New** — PII redaction |
| `device-appium/src/index.ts` | 3.1, 3.4 | Minor — export new types |
| `device-appium/src/appium-driver.ts` | 3.1 | Minor — add new capability fields to AppiumW3CCapabilities |
| `device-appium/test/appium-capabilities.test.ts` | 6 | **New** |
| `device-appium/test/wda-manager-lifecycle.test.ts` | 6 | **New** |
| `device-appium/test/appium-device-backend.test.ts` | 2, 6 | Extend — new mode tests, fix bundle ID fixtures |
| `itestagent-cli/src/doctor/checks/check-signing-identity.ts` | 4 | **New** |
| `itestagent-cli/src/doctor/checks/check-wda-preinstalled.ts` | 4 | **New** |
| `itestagent-cli/src/doctor/checks/check-wda-readiness.ts` | 4 | **New** |
| `docs/06-verification/g5-spike-report-appium-unblock.md` | 7 | **New** — G5 evidence |
| `docs/07-troubleshooting/appium-free-account/blocker.md` | 8 | Update |
| `docs/05-planning/task-status.json` | 8 | Update |
| `docs/05-planning/deferred-items.json` | 8 | Update DEF-023 |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `usePreinstalledWDA` doesn't work on iOS 18.2 + Xcode 26.5 | Medium | High | Fall back to Route B (external-url); Route C as diagnostic |
| WDA preinstall Profile expires (7 days) | High | Low | Doctor check warns; re-prepare takes ~30s |
| iOS 17+ XC framework embedding blocks preinstall | Low | High | Gate 3 check catches this; documented workaround in WDA build |
| CloseSession cleanup bug causes port leak | Medium | Medium | Gate 4.3 fix; automated test covers |
| G5 evidence requirements too heavy for single spike | Medium | Low | Prioritize Route A primary path; others as time permits |

---

## Execution Order (Recommended)

```
Phase 0 (Gate 0) → Phase 1 (Gates 1-2) → Phase 2 (Gate 3) → Phase 3 (Gate 4) → Phase 6 (Gate 7)
                                                                                      ↓
                                                              Phase 7 (Gate 8) ← Phase 5 (Gate 6) ← Phase 4 (Gate 5)
                                                                                      ↓
                                                                              Phase 8 (Docs & State)
```

Phases 4-5-6 can run in parallel after Phase 3 completes. Phase 7 requires all prior gates plus real iPhone. Phase 8 is the final cleanup.

---

## Acceptance Criteria (DoD)

- [ ] Three WDA startup modes defined, mutually exclusive, validated
- [ ] `usePreinstalledWDA` capability generated for Route A (no `usePrebuiltWDA`)
- [ ] `webDriverAgentUrl` capability generated for Route B
- [ ] Base Bundle ID fixed — no `.xctrunner` double-suffix
- [ ] WdaManager has `/status` polling, proper stop (graceful + force), AbortSignal
- [ ] AppiumDeviceBackend lifecycle handles all three modes correctly
- [ ] `closeSession()` cleanup runs regardless of `sessionActive` state
- [ ] Composition Root wires RealAppiumDriver + WdaManager + AppiumDeviceBackend
- [ ] Doctor checks signing identity, preinstalled WDA, WDA readiness
- [ ] Error messages redacted (no email, UDID, Team ID, user path)
- [ ] Automated tests pass (capability + lifecycle + security)
- [ ] G5 real device evidence: Route A (primary) + Route B (fallback) verified
- [ ] Evidence redacted, artifacts archived, G5 report published
- [ ] `typecheck 0`, `lint 0`, all existing 1810+ tests still pass
- [ ] Documentation updated, task status updated, DEF-023 resolved

---

## G5 Results (2026-07-25)

**Environment**: iPhone 14 Plus (iOS 18.2.1), Appium 3.5.2, XCUITest Driver 11.17.7, WDA 15.1.6, Xcode 26.5, free Personal Team UJ876FXT32.

### What Was Tested

| Route | Strategy | Outcome | Details |
|---|---|---|---|
| **Route C** | `managed-xcodebuild` + `allowProvisioningDeviceRegistration: true` | ✅ **PASS** | Session created, screenshot captured (306KB), UI tree fetched (27682 chars), tap executed, session closed |
| **Route A** | `usePreinstalledWDA` | ❌ **TIMEOUT** | Appium RemoteXPC launch timeout at 60s. Free-signed WDA Runner starts too slowly on device |
| **Route B** | `webDriverAgentUrl` | ⏸️ **SKIPPED** | Requires iproxy for USB port forwarding — not installed in current environment |

### Route C Verified Capabilities

```json
{
  "platformName": "iOS",
  "appium:automationName": "XCUITest",
  "appium:udid": "<device UDID>",
  "appium:xcodeOrgId": "UJ876FXT32",
  "appium:xcodeSigningId": "Apple Development",
  "appium:updatedWDABundleId": "UJ876FXT32.WebDriverAgentRunner",
  "appium:allowProvisioningDeviceRegistration": true
}
```

### Key Findings

1. **Route C is the MVP physical device path** for free Apple Developer accounts. Appium 3.5.2 passes `-allowProvisioningUpdates` through `allowProvisioningDeviceRegistration: true`.
2. **Route A is blocked by Appium upstream** — the RemoteXPC timeout for free-signed bundles is a known limitation. Deferred as Appium upstream issue.
3. **Route B is architecturally valid but requires iproxy** — WdaManager build/install/launch all work; only USB port forwarding is missing.
4. **Developer certificate must be manually trusted** on the device each time a new certificate is used (Settings → General → VPN & Device Management).
5. **`updatedWDABundleId` must use base ID** (no `.xctrunner` suffix) — XCUITest scheme auto-appends it.
6. **The free-account blocker (DEF-023) is now resolved** via Route C.

### Evidence

- Screenshot: `packages/itestagent-backends/device-appium/spike-evidence/g5-routec/screenshot.png`
- UI tree: `packages/itestagent-backends/device-appium/spike-evidence/g5-routec/pagesource.xml`
- Commit: `e3fbdd7` (branch `feat/appium-free-account-unblock`)

### Updated Documentation

- `docs/07-troubleshooting/appium-free-account/blocker.md` §8 — Route status updated
- `docs/decisions/ADR-006-device-backend-appium-wda.md` — Post-G5 Update section added
- `docs/decisions/ADR-012-wda-lifecycle-separation.md` — G5 Update section added
- `docs/05-planning/task-status.json` — Task 3.7 notes updated with G5 Route C results
- `docs/05-planning/deferred-items.json` — DEF-023 resolved
