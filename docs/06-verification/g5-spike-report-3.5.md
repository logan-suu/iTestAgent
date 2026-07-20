# G5 Spike Report — Task 3.5: BuildDriver devicectl Install/Launch + Signing Diagnostics

**Date**: 2026-07-21
**Task**: 3.5 — BuildDriver: devicectl 安装/启动 + 签名（fastlane）链路
**Tester**: Sisyphus (AGENTS.md)
**Related PR**: [#32](https://github.com/logan-suu/iTestAgent/pull/32)

---

## Environment

| Item | Value |
|---|---|
| **Device** | iPhone 14 Plus (iPhone14,8) |
| **UDID** | F7C1CF80-8A2C-5AFB-85FE-C959DC4EC1F9 |
| **State** | available (paired) |
| **Xcode** | 26.5 (17F42) |
| **macOS** | darwin |
| **Signing Identity** | Apple Development: suweipeng1025@gmail.com (L4CX67KLT5) |

---

## Verification Results

### 1. Device Connectivity (Pre-check)

```
$ xcrun devicectl list devices
Logan's phone | F7C1CF80-8A2C-5AFB-85FE-C959DC4EC1F9 | available (paired)

$ xcrun devicectl device info details --device F7C1CF80-8A2C-5AFB-85FE-C959DC4EC1F9
cpuType: arm64e | marketingName: iPhone 14 Plus | platform: iOS
```

✅ **Pass** — Device connected, responsive to devicectl.

### 2. Code Signing Diagnostics (Error Path)

```
$ xcodebuild build (manual signing, no provisioning profile)
error: No profiles for 'name.logan.Car-Logo-Detect' were found
```

**Signing Diagnostic Output**:
```
✅ Matched: no_provisioning_profile
Reason: No provisioning profile found matching the bundle identifier and signing certificate.
FixGuide:
  1. Check that a provisioning profile exists in Xcode
  2. If the project uses manual signing, verify the provisioning profile is assigned
  3. If the project uses automatic signing, ensure your Apple ID team is selected
  4. Run: fastlane sigh (if fastlane is configured)
```

✅ **Pass** — Signing error correctly detected and diagnosed.

### 3. xcodebuild Build (Success Path)

```
Project: TestSwiftUI (SwiftUI, no dependencies)
Build: xcodebuild -project TestSwiftUI.xcodeproj -scheme TestSwiftUI \
       -configuration Debug -destination "platform=iOS,id=<UDID>" \
       -allowProvisioningUpdates build

Result: ** BUILD SUCCEEDED **
Output: /tmp/itestagent-g5-build3/Build/Products/Debug-iphoneos/TestSwiftUI.app
```

✅ **Pass** — Build produces valid .app bundle.

### 4. devicectl Install

```
$ xcrun devicectl device install app --device <UDID> <appPath>
App installed:
  bundleID: name.logan.TestSwiftUI
  installationURL: file:///.../TestSwiftUI.app/
```

✅ **Pass** — .app installed to device successfully.

### 5. devicectl Launch

```
$ xcrun devicectl device process launch --device <UDID> name.logan.TestSwiftUI
Launched application with name.logan.TestSwiftUI bundle identifier.
```

✅ **Pass** — App launched successfully.

### 6. devicectl Terminate (Two-Step)

```
$ xcrun devicectl device info processes --device <UDID>
→ Extract PID for TestSwiftUI: 1499

$ xcrun devicectl device process terminate --device <UDID> --pid 1499
Sent signal to terminate process sent to pid 1499

$ xcrun devicectl device info processes --device <UDID> | grep -i testswift
(no longer running)
```

✅ **Pass** — Process terminated via PID-based approach.

### 7. devicectl Uninstall (Cleanup)

```
$ xcrun devicectl device uninstall app --device <UDID> name.logan.TestSwiftUI
App uninstalled.
```

✅ **Pass** — Cleanup successful.

---

## Findings & Fixes

### 🔴 F-1: `terminateApp` command format incorrect

**Problem**: The original implementation passed `bundleId` as a positional argument to `devicectl device process terminate`, but the CLI requires `--pid <pid>` instead of a bundle identifier.

**Fix**: Redesigned `terminateApp` as a two-step process:
1. `devicectl device info processes --device <UDID>` → extract PID from process listing
2. `devicectl device process terminate --device <UDID> --pid <pid>`

**Commit**: `9188823`

### 🔴 F-2: Signing diagnostic missed "No profiles for X" pattern

**Problem**: Real xcodebuild output "No profiles for 'name.logan.Car-Logo-Detect' were found" did not match the existing `/no\s+provisioning\s+profile/i` regex.

**Fix**: Extended `no_provisioning_profile` pattern to match: `no\s+profiles\s+for\s+'.*'\s+were\s+found`

**Commit**: `9188823`

---

## Risk Assessment

| Risk | Level | Notes |
|---|---|---|
| `terminateApp` two-step fragility | 🟡 Low | Process listing is text-parsed (not JSON); formatting may change across Xcode versions. Acceptable for MVP — JSON output should be used for production robustness. |
| `extractPidFromProcessList` uses app name substring match | 🟡 Low | Could match wrong process if app name is a substring of another process path (e.g., "Test" matching "TestSwiftUI" and "TestHelper"). Acceptable for MVP — bundle ID match provides baseline filtering. |
| `devicectl device process` Xcode version sensitivity | 🟡 Low | Command format validated against Xcode 26.5. Earlier Xcode versions may have different flags. |

---

## Conclusion

All G5 device operations (install, launch, terminate, uninstall) verified against real iPhone 14 Plus hardware. Two command-format issues discovered and fixed in the same PR. Signing error diagnosis validated against real xcodebuild output. **G5 spike: PASS**.

---

## Integration Notes for Phase 3 Integration Test (Task 3.17)

- `terminateApp` should be tested with `devicectl device info processes --json-output <path>` for structured PID extraction (future improvement)
- `launchApp` with `--terminate-existing` was not explicitly tested but shares the same `devicectl device process launch` command path verified in step 5
- `openDeepLink` was not G5-tested due to no app with deep link handling on the test device; should be verified in Task 3.7/3.17
