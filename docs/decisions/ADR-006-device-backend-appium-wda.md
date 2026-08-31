# ADR-006: DeviceBackend 选型——Appium/WDA 为主 + MockBackend 为 CI baseline

**状态**: 已接受
**日期**: 2026-07-15
**决策人**: AI Agent（基于 T0.2 + T0.2b 横评实测）
**关联**: ADR-005、T0.2/T0.2b 横评文档

## 背景

iTestAgent 需要在 iPhone 真机上执行 UI 自动化（截图、UI tree、tap/swipe/typeText）。ADR-005 确定了可插拔 Backend 架构，Phase 0 需对 DeviceBackend 候选做多路横评。

候选：Appium/WDA、mobile-mcp (@mobilenext/mobile-mcp)、iphone-use、MockBackend。

## 横评结果

| Backend | 设备发现 | 截图 | UI tree | Tap | 免费账号 | 独特能力 | 总分 |
|---|---|---|---|---|---|---|---|
| **Appium/WDA** | ✅ | ✅ 305KB | ✅ 49596 chars | ⏳ 待补 | ✅ 可用（workaround） | — | 5/5 |
| **MockBackend** | ✅ | ✅ fixture | ✅ fixture | ✅ fixture | N/A | CI baseline | 5/5 |
| **mobile-mcp** | ✅ | ❌ 需 agent | ❌ 需 agent | ❌ 需 agent | ❌ 需付费 | WebView/FS/Crash/Remote/MCP-native | 3/5 |
| **iphone-use** | N/A | N/A | N/A | N/A | N/A | 视觉 fallback | 2/5 |

### 关键发现

1. **Appium/WDA 免费账号可用**（T0.2b 验证）：WDA 默认 bundle ID `com.facebook.WebDriverAgentRunner.xctrunner` 被 Facebook 注册。Workaround：改 bundle ID 为 `TEAMID.WebDriverAgentRunner.xctrunner` + `xcodebuild -allowProvisioningUpdates` + `usePrebuiltWDA: true`。免费账号 profile 7 天过期需定期重建。

2. **mobile-mcp 免费账号不可用**：mobilecli 下载预编译 IPA + 手动重签。免费账号无法创建通配符 profile → bundle ID 不匹配 → Catch-22。需付费 Apple Developer Program（$99/年）。

3. **Appium vs mobile-mcp 签名机制差异**：Appium 从源码编译 WDA → Xcode 自动签名（免费账号可）。mobile-mcp 用预编译 IPA → 需手动提供 profile（免费账号不可）。

## 决策

```
MVP 主 backend   = Appium/WDA（免费账号可用，真机 session/UI tree/screenshot 全验证）
CI/no-device     = MockBackend（fixture + TDD 验证）
强候选（后置）   = mobile-mcp（MCP-native + 独特能力，待付费账号补测 screenshot/UI tree/tap）
Phase 7+ fallback = iphone-use（视觉 fallback）
```

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Appium/WDA 为主** | 免费账号可用、WebDriver 标准协议成熟、日志体系完善 | WDA bundle ID 需改、profile 7 天过期、3-app 上限 | ✅ 选择 |
| mobile-mcp 为主 | MCP-native 天然适配 iTestAgent、WebView/FS/Crash 独特能力 | 免费账号不可用、需付费 $99/年、mobilecli 硬编码 bundle ID | ❌ 后置（待付费账号） |
| 两者并用 | 能力互补 | 维护成本翻倍、签名前置复杂 | ❌ MVP 不取 |

## 实施

### Appium/WDA 免费账号 workaround（落入 T1.4 doctor）

1. 检测开发者证书（`security find-identity -p codesigning`）
2. 检测 WDA 是否已预编译（DerivedData）
3. 检测 WDA profile 是否过期（7 天）
4. 如未预编译，引导用户执行 3 步 workaround：
   - `xcodebuild build-for-testing -allowProvisioningUpdates PRODUCT_BUNDLE_IDENTIFIER=TEAMID.WebDriverAgentRunner.xctrunner`
   - Appium `usePrebuiltWDA: true` + `updatedWDABundleId`
   - 定期重建（profile 过期时）

### mobile-mcp 后置补测条件

- 付费 Apple Developer Program → 创建通配符 profile → `mobilecli agent install`
- 验证 screenshot + UI tree + tap 质量
- 对比与 Appium/WDA 的 accessibility tree 质量

## 后果

### 正面
- Appium/WDA 免费账号可用，降低 iTestAgent 使用门槛
- WebDriver 协议成熟，社区支持广泛
- MockBackend 保障 CI 和无真机开发

### 负面
- WDA 预编译 workaround 增加首次配置复杂度（需 doctor 引导）
- 免费 profile 7 天过期需定期重建
- mobile-mcp 独特能力（WebView/FS/Crash/Remote）暂时无法使用
- 3-app 上限约束（WDA + 用户 app + 测试目标 app = 3）

## Post-G5 Update (2026-07-25)

G5 真机验证发现免费 Apple Developer 账号下有三种 Appium/WDA 启动路由，实际测试结果如下：

### Route C (G5 VERIFIED): `managed-xcodebuild` + `allowProvisioningDeviceRegistration`

这是当前唯一在免费账号下可用的 Appium 真机路径。

**Capabilities**：
```json
{
  "appium:xcodeOrgId": "UJ876FXT32",
  "appium:xcodeSigningId": "Apple Development",
  "appium:updatedWDABundleId": "UJ876FXT32.WebDriverAgentRunner",
  "appium:allowProvisioningDeviceRegistration": true
}
```

**关键点**：
- `updatedWDABundleId` 使用 base ID（不加 `.xctrunner`），XCUITest scheme 自动追加
- `allowProvisioningDeviceRegistration: true` 使 Appium 3.5.2 在其 xcodebuild 中传递 `-allowProvisioningUpdates`
- 开发者证书必须手动在设备上信任
- G5 证据：screenshot 306KB、UI tree 27682 chars，iPhone 14 Plus iOS 18.2.1，commit `e3fbdd7`

### Route A (G5 FAILED): `usePreinstalledWDA`

Appium 在 `preinstalledWDA` 策略下通过 RemoteXPC 启动设备端 WDA 进程时，内部 60s 超时。免费签名后的 WDA Runner 在设备端启动较慢（在线验证），无法在 60s 内完成 RemoteXPC 连接。这是 Appium 上游问题。

### Route B (NOT TESTED): `webDriverAgentUrl`

要求 iproxy 做 USB 端口转发（`iproxy <localPort> 8100 <UDID>`），当前环境未安装。

### 对 ADR-006 原 decision 的影响

原 ADR-006 中的免费账号 workaround（`usePrebuiltWDA: true` + manual xcodebuild + `-allowProvisioningUpdates`）已被 Route C 简化。`usePrebuiltWDA` 不再推荐——它跳过 `build-for-testing` 但不跳过 `test-without-building`，后者仍无 `-allowProvisioningUpdates`。Route C 的 `allowProvisioningDeviceRegistration` 从 capabilities 层面解决了此问题。

## 参考

- `docs/02-architecture/架构设计文档.md` §5.1 — DeviceBackend 接口与候选
- `docs/02-architecture/技术选型文档.md` §9 — 真机执行技术栈
- `~/Desktop/横评/T0.2 Device backend 横评.md` — 公司电脑横评
- `~/Desktop/横评/T0.2b mobile-mcp 横评补充.md` — 个人电脑横评 + Appium/WDA 免费账号验证
- `docs/decisions/ADR-005` — 可插拔 Backend 架构
- `docs/decisions/ADR-012` — WDA 生命周期分离
- `docs/07-troubleshooting/appium-free-account/blocker.md` — 免费账号阻塞根因分析
