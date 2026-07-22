# G5-SIM Spike Report — Task 3.10: AppiumDeviceBackend Simulator Adapter

**Date**: 2026-07-22
**Task**: 3.10 — AppiumDeviceBackend simulator adapter extension (simctl + Appium/WDA)
**PR**: [#36](https://github.com/logan-suu/iTestAgent/pull/36)
**ADR**: ADR-011 — iOS Simulator First-Class Support
**Environment**: macOS + Xcode 26.5 / CoreSimulator / iOS 18.2 / iOS 17.5 / iOS 26.5 runtimes / Appium 3.5.2 + XCUITest 11.17.7 / WebDriverIO

---

## Verification Goals

| # | Goal | Status |
|---|---|---|
| 1 | `listSimulatorDevices()` correctly parses `simctl list devices --json` | ✅ PASS |
| 2 | `simulatorHealthcheck()` correctly identifies booted vs non-existent devices | ✅ PASS |
| 3 | `listCrashes()` for simulator returns empty array (R5: simctl has no crash diagnostics) | ✅ PASS (code review) |
| 4 | Backend capabilities report `supportedTargetKinds: ['simulator']` | ✅ PASS (unit test) |
| 5 | Physical backend unchanged (backwards compat) | ✅ PASS (unit test) |
| 6 | Appium/WDA Simulator session end-to-end — `buildSimulatorCapabilities()` → session → page source / screenshot / tap / swipe / launchApp | ✅ PASS |

---

## Evidence

### Goal 1 — listSimulatorDevices() Parsing

**Method**: `AppiumDeviceBackend.listSimulatorDevices()` uses `Bun.spawnSync(['xcrun', 'simctl', 'list', 'devices', '--json'])`.

**Real simctl output** (35 devices across 3 runtimes):
```
iOS 18.2: iPhone 16 Pro (F3BF1718..., Booted), iPhone 16 Pro Max, iPhone 16, iPhone 16 Plus,
          iPhone 15 Pro, iPhone SE 3rd gen, iPad Pro/Air variants (9 devices)
iOS 17.5: iPhone 15 Pro Max, iPhone 15, iPhone 15 Plus, iPhone 14 Plus, iPhone SE 3rd gen,
          iPhone 13, iPad variants (8 devices)
iOS 26.5: iPhone 17 Pro, iPhone 17 Pro Max, iPhone 17e, iPhone Air, iPhone 17, iPad variants (8 devices)
```

**Parsing verification script** (`/tmp/verify-simctl-parse.ts`):
- Input: real `xcrun simctl list devices --json` output
- Parsed 35 devices, all valid (udid non-empty, all iOS runtimes)
- osVersion regex `iOS[- ](\d+)[-.](\d+)` correctly extracted: `18.2`, `17.5`, `26.5`
- iPhone 16 Pro identified: `name=iPhone 16 Pro, osVersion=18.2, state=booted, deviceTypeIdentifier=com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro`
- All fields populated: `udid`, `name`, `model` (== deviceTypeIdentifier), `osVersion`, `runtimeIdentifier`, `deviceTypeIdentifier`, `state`, `targetKind: 'simulator'`

**Verdict**: ✅ Parsing logic matches real simctl JSON output. No edge cases found.

### Goal 2 — simulatorHealthcheck()

**Method**: `AppiumDeviceBackend.simulatorHealthcheck(deviceId)` traverses `simctl list devices --json` looking for matching UDID.

**Test case 1 — Booted device**:
```
Input:  F3BF1718-247D-4CB2-AAAF-F7738514B14D (iPhone 16 Pro, iOS 18.2, state: Booted)
Result: healthy: true ✅
```

**Test case 2 — Non-existent device**:
```
Input:  00000000-0000-0000-0000-000000000000
Result: healthy: false, details: "Simulator ... not found in simctl device list" ✅
```

**Verdict**: ✅ Healthcheck correctly identifies booted devices as healthy and non-existent devices as unhealthy.

### Goal 3 — listCrashes() for Simulator

**Method**: `AppiumDeviceBackend.listCrashes()` returns `[]` immediately for `targetKind === 'simulator'`.

**Rationale**: `simctl` has no crash diagnostic command equivalent to `devicectl device info diagnostics`. Simulator crash logs live in `~/Library/Logs/DiagnosticReports/` and are not queryable through a standard CLI. Per R5, we return empty array — caller must interpret this as "not available for this target kind."

**Verdict**: ✅ Code-level verification. Correct R5 fallback. Documented in code comments.

### Goals 4 & 5 — Capabilities & Backwards Compatibility

**Verified via unit tests** (1222/1222 pass):
- `simulator targetKind → supportedTargetKinds: ['simulator']`, `supportsCrashLogs: false`
- `physical targetKind → supportedTargetKinds: ['physical']`, `supportsCrashLogs: true` (unchanged)
- All 66 existing physical tests pass without modification

### Goal 6 — Appium/WDA Simulator Session (End-to-End)

**Method**: Verification script `scripts/g5-sim-verify-session.ts` uses the actual `buildSimulatorCapabilities()` from our codebase to create an Appium session via WebDriverIO, then exercises core DeviceBackend operations.

**Environment**: Appium 3.5.2 + XCUITest driver 11.17.7 + WebDriverIO, running on iPhone 16 Pro (iOS 18.2 CoreSimulator, headless).

**Results** (8/8 PASS):

| Step | Result | Detail |
|---|---|---|
| `buildSimulatorCapabilities()` | ✅ PASS | `usePrebuiltWDA=false`, no `updatedWDABundleId`, `bundleId=com.apple.Preferences` |
| Appium session created | ✅ PASS | 54,422ms (WDA first-build ~45s + session init ~9s) |
| `getPageSource()` | ✅ PASS | 38,210 chars, ~159 elements (Settings app home) |
| `takeScreenshot()` | ✅ PASS | base64 PNG, 284,944 chars |
| `tap()` | ✅ PASS | Tapped at center (201, 437) of 402×874 screen via W3C Actions |
| `swipe()` | ✅ PASS | Swiped up on simulator via W3C Actions |
| `launchApp()` | ✅ PASS | Launched Safari and re-launched Settings |
| Re-launch + page source | ✅ PASS | 24,104 chars, re-launch successful |

**Key observations**:
- WDA first-build time ~45s consistent with T1.6 findings (subsequent sessions reuse built WDA)
- `buildSimulatorCapabilities()` produces correct W3C caps — no `updatedWDABundleId`, `usePrebuiltWDA: false`
- All W3C Actions work on simulator (tap, swipe, launchApp)
- Session cleanup successful

**Verdict**: ✅ Full end-to-end verified. Our `buildSimulatorCapabilities()` → Appium session pipeline works on real CoreSimulator runtime.

---

## Implementation Warnings (from T1.6, applicable to 3.10)

| # | Warning | Mitigation in 3.10 |
|---|---|---|
| W1 | Appium auto-builds WDA on first simulator session (~45s) — first test run is slow | `usePrebuiltWDA: false` is documented default; callers should pre-warm |
| W2 | Parallel sessions need unique `wdaLocalPort`/`mjpegServerPort`/`derivedDataPath` | All three fields exposed in `AppiumDeviceBackendOptions` and `SimulatorCapabilitiesOptions` |
| W3 | `pressButton` requires `mobile: pressButton` on simulator (W3C Actions API doesn't support it) | Same as physical — already handled in `pressButton()` |
| W4 | Session delete doesn't kill WDA process | `SessionManager` responsibility (deferred to 3.12+) |
| W5 | Simulator WDA version must match Xcode version | Re-run G5-SIM after Xcode upgrade (documented) |

---

## Risk Assessment

| Risk | Status |
|---|---|
| simctl JSON format changes across Xcode versions | ✅ Defensive parsing (iterates `devices` map keys, no hardcoded runtime names) |
| Simulator not booted → healthcheck returns false | ✅ Expected behavior; caller should boot before healthcheck |
| Appium/WDA session with `buildSimulatorCapabilities()` fails | ✅ Verified — see Goal 6 |
| Crash logs unsupported on simulator | ✅ Documented; returns empty with explanatory comment |

---

## Conclusion

**6/6 goals PASS.** Full end-to-end verification complete.

The simctl parsing and healthcheck logic has been verified against real CoreSimulator runtime output (iOS 18.2, 35 devices across 3 runtimes). The Appium/WDA session pipeline (`buildSimulatorCapabilities()` → session → page source / screenshot / tap / swipe / launchApp) has been verified end-to-end on a headless iPhone 16 Pro simulator (Appium 3.5.2, XCUITest 11.17.7). Backwards compatibility with physical backend is confirmed via unit tests.

**G5-SIM for task 3.10: ✅ PASSED.**
