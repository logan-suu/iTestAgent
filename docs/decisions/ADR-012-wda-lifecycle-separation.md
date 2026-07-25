# ADR-012: WDA Lifecycle Separation — iTestAgent Owns WDA, Appium Only Handles WebDriver Session

**Status**: Accepted
**Date**: 2026-07-21
**Deciders**: Logan Su + Sisyphus (AGENTS.md)
**G5 Evidence**: G5 spike report 3.7 §3a-3c (devicectl install ✅, xcodebuild test-without-building ✅, Appium xcodebuild ❌)

---

## Context

Task 3.7 (AppiumDeviceBackend) implements the `DeviceBackend` interface for physical devices using Appium/WDA. During G5 spike verification, a persistent blocker emerged:

**Appium's `real-device-xcodebuild` WDA startup strategy always runs `xcodebuild build-for-testing test-without-building`**, even with `usePrebuiltWDA: true`. On Xcode 26 + free Apple Developer account, this fails because:

1. Appium does not pass `-allowProvisioningUpdates` to xcodebuild
2. The `WebDriverAgentLib` target hardcodes `CODE_SIGN_IDENTITY = "iOS Development"`, conflicting with `Apple Development` certificates
3. Free account provisioning profiles expire every 7 days
4. The `No Account for Team` error appears when Xcode's account session token expires

Meanwhile, **WDA build, install, and launch all succeed when managed outside of Appium**:

| Operation | Via Appium xcodebuild | Via direct devicectl/xcodebuild |
|---|---|---|
| WDA build | ❌ code 65 | ✅ Xcode GUI ⌘B or manual xcodebuild |
| WDA install | ❌ bundled in build step | ✅ `devicectl device install app` |
| WDA launch | ❌ bundled in `test-without-building` | ✅ `xcodebuild test-without-building` (no build step) |
| WebDriver session | ✅ WebDriver protocol | ✅ Same protocol — Appium just connects |

**Core insight**: Appium's value to iTestAgent is the **WebDriver protocol layer** (session management, W3C Actions, element inspection), not the xcodebuild build pipeline. The xcodebuild pipeline is a legacy convenience for standalone Appium usage, but it couples WDA lifecycle with WebDriver session creation, creating a fragile single point of failure.

## Decision

**iTestAgent owns the WDA lifecycle. Appium is reduced to a WebDriver session connector.**

### Architecture

```
Before (Appium monolithic):
  Appium → xcodebuild build-for-testing → install → test-without-building → WDA → WebDriver session

After (iTestAgent-managed WDA):
  iTestAgent → devicectl install
  iTestAgent → xcodebuild test-without-building (keep alive as subprocess)
  Appium    → connect to localhost:<wdaPort> (WebDriver session only, no xcodebuild)
```

### New Component: WdaManager

A lightweight lifecycle manager in `itestagent-backends/device-appium`:

```
WdaManager {
  build(options):    // xcodebuild with -allowProvisioningUpdates
  install(udid):     // devicectl device install app  
  launch(udid):      // xcodebuild test-without-building → keeps process alive
  connect(port):     // returns WDA URL (localhost:<port>)
  stop():            // SIGTERM xcodebuild process
  isRunning():       // health check
}
```

### AppiumDeviceBackend Changes

- Constructor accepts an optional `WdaManager` instance
- If a `WdaManager` is provided, `ensureSession()` calls `wdaManager.launch()` then connects Appium to `http://localhost:<port>` (skipping Appium's xcodebuild entirely)
- If no `WdaManager`, falls back to Appium's built-in WDA startup (existing behavior, for compatibility)
- Appium server still needed for WebDriver protocol — but only for session management, not WDA lifecycle

### Appium Capabilities

When using WdaManager:
- `appium:usePrebuiltWDA: true`
- `appium:useNewWDA: false` 
- `appium:wdaLocalPort: <port>`
- No `appium:xcodeOrgId`, `appium:xcodeSigningId`, `appium:updatedWDABundleId` needed
- Appium connects to the already-launched WDA without running xcodebuild

### Benefits

1. **Eliminates free-account blocker**: WDA build/sign/install handled directly, with `-allowProvisioningUpdates` passed explicitly
2. **Faster session creation**: WDA lifecycle is decoupled from session — WDA can be pre-launched once and reused across multiple test runs
3. **Better error messages**: iTestAgent controls the xcodebuild output, can parse errors into actionable doctor advice
4. **Cleaner abort**: SIGTERM the xcodebuild process directly, no Appium abstraction layer
5. **Simulator compatible**: WdaManager works for both physical and simulator (ADR-011), the only difference is `devicectl install` vs `simctl install`

### Risks & Mitigation

| Risk | Mitigation |
|---|---|
| WdaManager is additional code to maintain | It's a thin shell (4 methods, ~200 lines) over tools already verified in G5 spikes |
| Appium may change its WDA startup strategy | We bypass Appium's startup entirely — this change is orthogonal to our approach |
| WdaManager port conflicts | SessionManager already manages unique ports per session (ADR-011, Task 1.6) |
| xcodebuild orphan process | Bun.spawn with AbortSignal, same pattern as SubprocessController (Task 1.15) |

## Consequences

### Positive
- G5 physical device verification becomes achievable with free account
- WDA lifecycle can be debugged independently from Appium
- Enables WDA reuse across multiple WebDriver sessions (faster test iteration)
- Aligns with the architecture principle from ADR-005: "Backend implementations are independently replaceable per target kind"
- Shrinks Appium's role to its core value: WebDriver protocol

### Negative
- iTestAgent takes on WDA lifecycle responsibility (~200 lines of new code)
- Need to maintain WDA source compatibility with Xcode versions
- Additional subprocess to manage during test runs

### Implementation Order
1. ADR-012 (this document)
2. `WdaManager` implementation in `device-appium/src/wda-manager.ts`
3. Update `AppiumDeviceBackend` to accept WdaManager
4. G5 spike: verify end-to-end with self-managed WDA
5. `AppiumEnvironmentSetup` task (3.7b) automates the one-time setup

## References
- ADR-005: Pluggable Backend Architecture
- ADR-006: Device Backend Evaluation (Appium/WDA as primary)
- ADR-010: Agent Harness Runtime Boundary
- ADR-011: iOS Simulator First-Class Support
- G5 Spike Report 3.7: `docs/06-verification/g5-spike-report-3.7.md`

## G5 Update (2026-07-25)

G5 真机验证于 iPhone 14 Plus (iOS 18.2.1) 上执行，测试了 WdaManager 的三种路由策略。

### WdaManager Build/Install — Verified

WdaManager 的构建和安装能力已验证通过：
- `WdaManager.build()` ✅ — 22s，`xcodebuild build-for-testing` + `-allowProvisioningUpdates`
- `WdaManager.install()` ✅ — `devicectl device install app` 成功
- `WdaManager.launch()` ✅ — `xcodebuild test-without-building` direct launch，WDA PID on device

### Route C (Appium-managed xcodebuild) — G5 VERIFIED

这是目前唯一可用的免费账号 Appium 真机路径。Appium 通过 `allowProvisioningDeviceRegistration: true` capability 传递 `-allowProvisioningUpdates` 给其内部 xcodebuild，无需 WdaManager 介入 launch 阶段。Session → screenshot → UI tree → tap → close 全链路通过。

WdaManager 在 Route C 中的角色：仅用于 WDA 构建和安装（一次性操作），不参与每次 session 的 WDA 启动。

Route C partially reverses this ADR's original premise: Appium now manages WDA startup (xcodebuild with -allowProvisioningUpdates), while WdaManager is reduced to build+install only for the physical path.

### Route B (Full WdaManager lifecycle) — Pending

Route B 要求 WdaManager 全权管理 WDA 生命周期（build → install → launch → /status → stop），Appium 仅通过 `webDriverAgentUrl` 连接。此路由需要 iproxy for USB port forwarding (`iproxy <localPort> 8100 <UDID>`)，当前环境未安装。在 iproxy 就绪后可作为未来优化路径（减少 xcodebuild 调用频率）。

### Free-account Blocker Resolution

原 ADR-012 描述的免费账号阻塞问题（Appium 不传 `-allowProvisioningUpdates`）已通过 `allowProvisioningDeviceRegistration: true` capability 解决。Appium 3.5.2 原生支持此 capability，无需修改 Appium 源码。此为 Route C 的核心突破。

### Updated Architecture Notes

WdaManager 仍保留其完整生命周期管理能力（build/install/launch/connect/stop），但在 MVP 阶段：
- **Route C（默认）**：WdaManager 仅用于 build + install；Appium 通过 `managed-xcodebuild` + `allowProvisioningDeviceRegistration` 管理每次 session 的 WDA 启动
- **Route B（未来）**：WdaManager 管理完整 WDA 生命周期，Appium 仅 WebDriver session
