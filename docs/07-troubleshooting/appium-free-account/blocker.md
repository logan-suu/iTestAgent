# Appium 免费 Apple Developer 账号真机阻塞——根因分析与解决方案尝试记录

**日期**: 2026-07-25  
**环境**: macOS + Xcode 26.5 + Appium 3.5.2 + XCUITest Driver 11.17.7 + iPhone 14 Plus (iOS 18.2.1)  
**Team ID**: UJ876FXT32（免费 Personal Team）  
**关联**: Task 3.17 G5 Spike、ADR-012、DEF-012

---

> **状态更新（2026-07-25）**：✅ 已通过 Route C 解决。
> 本文 §1-§6 记录了问题背景与尝试过程（历史记录），§8 记录最终解决方案与 G5 验证结果。
> **有效路径**：`managed-xcodebuild` + `allowProvisioningDeviceRegistration: true`（Appium 3.5.2 + XCUITest Driver 11.17.7）。

---

## 1. 问题描述

iTestAgent 的设备探索路径（DeviceBackend）依赖 Appium/WebDriverAgent 在真机上创建 session。免费 Apple Developer 账号无法通过 Appium 完成 WDA 的启动，导致所有真机探索操作不可用（历史记录：Route C 已解决，见 §8）。

**错误现象**：

```
WebDriverError: Unable to launch WebDriverAgent.
Original error: xcodebuild failed with code 65.
```

---

## 2. 尝试过的解决方案（6 种，全部失败）

### 方案 A：通过 WdaManager 预构建 + Appium `usePrebuiltWDA`

**预期**：WdaManager 使用 `-allowProvisioningUpdates` 构建 WDA，安装到设备，Appium 跳过构建阶段直接用。

**实际**：Appium 的 `test-without-building` 阶段仍然运行自己的 xcodebuild，且不传 `-allowProvisioningUpdates`。

**结论**：❌ `usePrebuiltWDA` 只跳过 `build-for-testing`，不跳过 `test-without-building`。

---

### 方案 B：`appium:autoLaunch=false`

**预期**：Appium 完全跳过 WDA 启动，WdaManager 全权管理生命周期。

**实际**：`autoLaunch` 控制的是被测应用的启动，不是 WDA 的启动。WDA 启动完全由 XCUITest 驱动内部管理，不受此参数影响。

**结论**：❌ 误解了 capability 语义。

---

### 方案 C：`appium:additionalXcodebuildArgs`

**预期**：传递 `["-allowProvisioningUpdates", "DEVELOPMENT_TEAM=UJ876FXT32"]` 给 Appium 的 xcodebuild。

**实际**：此 capability 传递给的是 Appium 执行的其他 xcodebuild 命令（如 app build），而不是 WDA 的 `test-without-building`。

**结论**：❌ 参数未到达 WDA 构建阶段。

---

### 方案 D：直接修改 WDA pbxproj 的 DEVELOPMENT_TEAM

**预期**：修改 `/appium-webdriveragent/WebDriverAgent.xcodeproj/project.pbxproj` 中所有 `DEVELOPMENT_TEAM` 为 `UJ876FXT32`。

**操作**：
```bash
sed -i '' 's/DEVELOPMENT_TEAM = L4CX67KLT5/DEVELOPMENT_TEAM = UJ876FXT32/g' project.pbxproj
```

**实际**：手工 `xcrun xcodebuild build-for-testing` 成功（带 `-allowProvisioningUpdates`）。但 Appium 的 `test-without-building` 不传该 flag。

**结论**：❌ pbxproj 修改无法影响 Appium 内部的 xcodebuild 参数传递。

---

### 方案 E：`xcodeOrgId` + `xcodeSigningId` capabilities

**预期**：通过标准的 Appium capabilities 设置 Team ID 和签名身份。

```json
{
  "appium:xcodeOrgId": "UJ876FXT32",
  "appium:xcodeSigningId": "Apple Development",
  "appium:updatedWDABundleId": "UJ876FXT32.WebDriverAgentRunner.xctrunner"
}
```

**实际**：Appium 日志显示这些值被正确读取和传递给了 xcodebuild 命令行，但因为没有 `-allowProvisioningUpdates`，签名仍然失败。

Appium log 证据：
```
Normalized platformVersion capability value '18.2.1' to '18.2'
Using WDA path: '...appium-webdriveragent'
Removing WebDriverAgent runner app 'UJ876FXT32.WebDriverAgentRunner.xctrunner'
Selected 'real-device-xcodebuild' WebDriverAgent startup strategy
```

**结论**：❌ 参数正确传递，但缺少关键 flag。

---

### 方案 F：WdaManager 完整生命周期管理

**预期**：WdaManager 完成 build → install → launch 全流程后，Appium 通过 HTTP 连接到已运行的 WDA。

**流程**：
1. `WdaManager.build()` → ✅ 22s（成功）
2. `WdaManager.install()` → ✅（通过 devicectl 安装到设备）
3. `WdaManager.launch()` → ✅（xcodebuild test-without-building，PID 在设备上）
4. Appium `createSession` → ❌ 自己的 test-without-building 失败

**WdaManager 各步验证结果**：

```
WdaManager.build():
  ✅ BUILD SUCCEEDED (22s)
  Bundle: UJ876FXT32.WebDriverAgentRunner.xctrunner
  App: .../WebDriverAgentRunner-Runner.app

WdaManager.install():
  ✅ Installed via devicectl

WdaManager.launch():
  ✅ xcodebuild test-without-building launches WDA process on device
  Port: 8100
```

**结论**：❌ WdaManager 本身完美运行，但 Appium 拒绝使用已运行的 WDA。

---

## 3. 根因分析

### 3.1 Appium XCUITest 驱动的 WDA 启动策略

Appium XCUITest 驱动对于真机设备使用 `real-device-xcodebuild` 策略，该策略有**两个强制阶段**：

| 阶段 | 命令 | 是否可跳过 |
|---|---|---|
| `build-for-testing` | `xcodebuild build-for-testing ...` | ✅ `usePrebuiltWDA: true` 可跳过 |
| `test-without-building` | `xcodebuild test-without-building ...` | ❌ **不可跳过** |

`test-without-building` 阶段的作用是验证 WDA 能在设备上正确启动并通信。这个阶段是硬编码的，无法通过任何 capability 跳过。

### 3.2 签名失败的原因

`test-without-building` 阶段使用的 xcodebuild 命令：
```bash
xcodebuild test-without-building \
  -project .../WebDriverAgent.xcodeproj \
  -scheme WebDriverAgentRunner \
  -destination id=UDID \
  DEVELOPMENT_TEAM=UJ876FXT32 \
  CODE_SIGN_IDENTITY=Apple Development
  # ← 缺少 -allowProvisioningUpdates
```

缺少 `-allowProvisioningUpdates` 导致：
- 免费账号的 provisioning profile 无法自动生成
- 签名失败 → exit code 65
- WDA 未启动 → RemoteXPC 端口连接被拒绝

### 3.3 为什么不能修改 Appium 的行为

1. 修改 Appium XCUITest 驱动源码 — 违反复用原则（R2）
2. 修改 WDA project pbxproj — 只在 `build-for-testing` 阶段生效
3. Capability 传递 — `additionalXcodebuildArgs` 不传递给 `test-without-building`

---

## 4. 对 iTestAgent 的影响

### 4.1 免费 Apple Developer 账号用户

| 功能 | 状态 | 原因 |
|---|---|---|
| Simulator 设备探索 | ✅ 正常 | Simulator WDA 无需签名 |
| 真机 XCUITest（有测试） | ✅ 正常 | `xcodebuild test` 直连，不经过 Appium |
| 真机 DeviceBackend 探索 | ❌ 阻塞（历史记录：Route C 已解决） | Appium 无法启动 WDA |
| `itestagent doctor` | ✅ 正常 | 检测环境 |
| `itestagent devices` | ✅ 正常 | 通过 devicectl 发现设备 |

### 4.2 付费 Apple Developer 账号用户（$99/年）

| 功能 | 状态 |
|---|---|
| **全部功能正常** | ✅ |
| 真机 DeviceBackend 探索 | ✅ `xcodebuild` 签名自动通过 |
| Simulator 全链路 | ✅ |

### 4.3 解决方案优先级

| 优先级 | 方案 | 说明 |
|---|---|---|
| **P0（已实施）** | `itestagent doctor` 检测并提示 | Doctor 命令已检测 Appium/WDA 就绪状态，免费账号用户会收到引导提示 |
| **P1（短期）** | Simulator 优先策略 | MVP 阶段推荐免费用户使用 Simulator（G5-SIM 已验证通过） |
| **P2（中期）** | XCUITest 路径 | 引导有 XCUITest 的项目走 xcodebuild test 直连路径 |
| **P3（长期）** | Appium 上游修复 | 等待 Appium XCUITest 驱动支持免费账号的 `-allowProvisioningUpdates`（已废弃：Route C 提供更简单的方案） |
| **P4（长期）** | MobileMcpBackend | Task 3.6（因付费账号阻塞），MCP-native 方案可能绕过此问题（已废弃：Route C 提供更简单的方案） |

---

## 5. 已验证通过的组件

尽管整体真机链路无法打通，以下组件在本次 G5 Spike 中已验证通过：

| 组件 | 验证方式 | 结果 |
|---|---|---|
| `RealAppiumDriver` | 连接 Appium Server + 发送 session 请求 | ✅ |
| `RealAppiumDriver` 错误脱敏 | URL/ID 在错误消息中被替换 | ✅ |
| `WdaManager.build()` | `xcodebuild build-for-testing` + `-allowProvisioningUpdates` | ✅ 22s |
| `WdaManager.install()` | `devicectl device install app` | ✅ |
| `WdaManager.launch()` | `xcodebuild test-without-building` + WDA PID on device | ✅ |
| DEF-012 spawnSync→async | 7 处转换，真机实测无误 | ✅ |
| `capitalize` 格式修正 | wdio.remote() capabilities 嵌套 | ✅ |
| `productBundleIdentifier` 覆盖 | WdaManager 构建参数 | ✅ |

---

## 6. 关键发现

### 6.1 正确 Team ID 的获取方式

`security find-identity` 可能返回与 Xcode 内部数据库不同的 Team ID。

```bash
# 方法一（可能不准确）
security find-identity -v -p codesigning
# → L4CX67KLT5 （证书上的 Team ID）

# 方法二（准确）
defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier
# → UJ876FXT32 （Xcode 内部的免费 Team ID）
```

**教训**：应以 Xcode 内部数据库为准，因为 xcodebuild 查询的是 Xcode 的账户系统。

### 6.2 `productBundleIdentifier` 的正确格式

XCUITest 的 scheme 会自动追加 `.xctrunner` 后缀，因此：

```typescript
// ❌ 错误（导致 UJ876FXT32.WebDriverAgentRunner.xctrunner.xctrunner）
productBundleIdentifier: "UJ876FXT32.WebDriverAgentRunner.xctrunner"

// ✅ 正确（最终产物 UJ876FXT32.WebDriverAgentRunner.xctrunner）
productBundleIdentifier: "UJ876FXT32.WebDriverAgentRunner"
```

### 6.3 CoreDevice Identifier vs 传统 UDID

Xcode 26+ 使用 CoreDevice Identifier（如 `F7C1CF80-8A2C-5AFB-85FE-C959DC4EC1F9`），而 Appium 需要传统 UDID。

```bash
# 获取传统 UDID
xcrun xctrace list devices 2>&1 | grep "phone"
# → 00008110-0012690901C1401E
```

---

## 7. 建议的后续行动

> 以下为 2026-07-25 的历史建议，已被 2026-09-04 的 Route B production default 决策取代；保留仅用于解释旧环境证据。

1. **短期（Phase 3 出口）**：在 `itestagent doctor` 中添加免费账号检测和引导提示（已实现）
2. **中期（Phase 4）**：在 `iTestAgent TUI` 启动时，如果检测到免费账号 + 真机探索路径，推荐 Route C（已实现）
3. **长期（Phase 5+）**：监控 Appium GitHub issues 中关于 free account + `-allowProvisioningUpdates` 的修复进展（已废弃：Route C 已解决）
4. **备用方案**：如果 Appium 长期不修复，考虑 MobileMcpBackend（Task 3.6）或直接 WDA HTTP 协议（已废弃：Route C 已解决）

---

## 8. 解决方案实施与 G5 验证结果（2026-07-25 / Updated 2026-07-26）

### 8.1 G5 验证总结

G5 真机验证于 2026-07-25 在 **iPhone 14 Plus (iOS 18.2.1)** 上执行，Appium 3.5.2 + XCUITest Driver 11.17.7 + WDA 15.1.6 + free Personal Team `UJ876FXT32`。三条路线结果如下：

| Route | 策略 | 结果 | 说明 |
|---|---|---|---|
| **Route C** | `managed-xcodebuild` + `allowProvisioningDeviceRegistration: true` | ✅ **G5 VERIFIED** | Session → screenshot (306KB) → UI tree (27682 chars) → tap → close。Appium 通过此 capability 传递 `-allowProvisioningUpdates` 给 xcodebuild |
| **Route A** | `usePreinstalledWDA` | ❌ **G5 TIMEOUT** | Appium 内部 `preinstalledWDA` RemoteXPC 启动超时 60s |
| **Route B** | `webDriverAgentUrl` | ⏸️ **NOT TESTED** | 需要 iproxy for USB port forwarding（未安装） |

**当前结论（2026-09-04）**：T6.4 已在同一真机上验证 Route B/C 均通过主动 readiness 与 Appium session。identity/abort 复验证明 Route B 正常与 abort 清理均无残留，Route C 则会遗留 Appium-owned `xcodebuild`。ADR-036 因此将 Route B 定为 physical production default；Route C 仅保留为用户显式诊断路线，不进入 auto 或静默 fallback，无法证明本轮独立 Appium lifecycle 与 child 完整回收时必须失败关闭并报告 cleanup limitation。详情见 ADR-028、ADR-036 与 `docs/06-verification/g5-sim-spike-report-6.4.md`。

### 8.2 Route C 详情：`managed-xcodebuild` + `allowProvisioningDeviceRegistration` ✅

**Capabilities**：
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

**关键点**：
- `updatedWDABundleId` 使用 base ID（不加 `.xctrunner` 后缀），XCUITest scheme 自动追加
- `allowProvisioningDeviceRegistration: true` 使 Appium 在其 xcodebuild 命令中传递 `-allowProvisioningUpdates`
- 开发者证书必须在设备上手动信任（首次/每次证书变更）
- Appium 3.5.2 / XCUITest 11.17.7 原生支持此 capability

**G5 证据**：
- Screenshot: `packages/itestagent-backends/device-appium/spike-evidence/g5-routec/screenshot.png` (306KB)
- UI tree: `packages/itestagent-backends/device-appium/spike-evidence/g5-routec/pagesource.xml` (27682 chars)
- Commit: `e3fbdd7` on branch `feat/appium-free-account-unblock`

### 8.3 Route A 详情：`usePreinstalledWDA` ❌

`usePreinstalledWDA` ≠ `usePrebuiltWDA`。前者完全跳过 Appium 的所有 xcodebuild，直接使用设备上已预安装的 WDA Runner。

**G5 结果**：超时。Appium 使用 `preinstalledWDA` 策略时，虽然跳过了 xcodebuild，但通过 RemoteXPC 启动设备上的 WDA 进程时，要求在 60s 内完成连接。免费账号下签名后的 WDA Runner 在设备端的启动时间不定，导致超时。

**架构变更（已实现，供参考）**：
- `appium-capabilities.ts`：新增 `WdaStartupMode`（三种互斥模式：`preinstalled` / `external-url` / `managed-xcodebuild`）
- `appium-device-backend.ts`：`ensureSession()` 按模式路由生命周期；`closeSession()` WDA 清理不再被 `sessionActive` 锁定
- `wda-manager.ts`：新增 `waitForReady()`（`/status` 轮询）、`verifyPreinstalledWDA()`、`preparePreinstalledWDA()`
- `composition-root.ts`：生产工厂函数 `createAppiumDeviceBackend()`
- `redactor.ts`：PII 脱敏（错误消息中去除 UDID/Team ID/用户路径）

**新增 Doctor 检查**：
- `check-signing-identity`：交叉验证 Team ID（xcodebuild/cert/profile）
- `check-wda-preinstalled`：验证 WDA Runner 已安装且 Profile 未过期
- `check-wda-readiness`：轮询 `/status` 确认 WDA 就绪

**提交**：`b96ec89`（核心代码）、`584fd65`（Doctor+测试）
**G3 验证**：typecheck 0 / lint 0 / 1845 tests pass

### 8.4 Route B 详情：`webDriverAgentUrl` ⏸️

iTestAgent 完全管理 WDA 生命周期（WdaManager build → install → launch），Appium 通过 USB 端口转发连接到已运行的 WDA。

**G5 状态**：未测试。WdaManager 的 build（22s）、install（devicectl）已验证通过，但 `webDriverAgentUrl` 要求 USB 端口转发（iproxy），当前环境未安装。

### 8.5 关键注意事项

- **证书信任**：首次在设备上使用新的免费开发者证书时，必须在设备上手动信任（Settings → General → VPN & Device Management）
- **Profile 过期**：免费账号 provisioning profile 7 天过期，需重建
- **3-app 上限**：免费账号最多 3 个 app（WDA Runner = 1 个）
- **设备端启动延迟**：免费签名后的 app 在设备端首次启动较慢（需在线验证），这导致了 Route A 的超时

---

## 附录：验证命令参考

```bash
# 获取设备列表（传统 UDID）
xcrun xctrace list devices

# 获取 CoreDevice Identifier
xcrun devicectl list devices

# 获取 Xcode 免费 Team ID
defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier

# 获取证书
security find-identity -v -p codesigning

# 手工构建 WDA（免费账号可用）
xcrun xcodebuild build-for-testing \
  -project .../WebDriverAgent.xcodeproj \
  -scheme WebDriverAgentRunner \
  -destination "id=UDID" \
  DEVELOPMENT_TEAM=UJ876FXT32 \
  PRODUCT_BUNDLE_IDENTIFIER=UJ876FXT32.WebDriverAgentRunner \
  -allowProvisioningUpdates

# 启动 Appium
npx appium -p 4723 --log-level info
```
