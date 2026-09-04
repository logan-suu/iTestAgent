# Task 6.4 G5 真机前置链验证报告

> **2026-09-04 decision update**：本报告保留 2026-09-01 的候选比较与证据事实。后续 T6.10 规格评审通过 ADR-036 将 Route B 定为 physical production default，Route C 改为用户显式诊断路线；Route C parity 不再阻塞 Route B 的 MVP 出口。原文中的“候选偏好”“最终默认等待 DEF-033”属于当时结论，已被 ADR-036 的决策状态取代。

**任务**：T6.4 真机执行前置链：App 来源归一化、构建安装启动、WDA 主动可用性与自愈

**验证时间**：2026-09-01

**当前结论**：自动化验证、App 构建/安装/启动与 WDA Route B/C 同设备 G5 均通过；任务按代码类状态机保持 `in_progress`，等待 PR 合并

## 验证范围

本报告验证 ADR-028 定义的真机执行前置链：

```text
已确认 TestPlan
  -> .app / .ipa / workspace 来源归一化
  -> 真机平台、arm64、bundle ID 与签名验证
  -> 设备健康与已安装 App 清单
  -> R7 覆盖安装确认
  -> devicectl install / launch
  -> 显式 Route B 或 Route C 主动 WDA/Appium 探针
  -> 必要时经 R7 确认准备 WDA并重新探测
```

测试步骤派发属于 T6.5，不在本任务范围内。Simulator 前置链也不在本次 T6.4 G5 范围内，因此本报告不声明 G5-SIM 通过。

## 自动化证据

- `PhysicalAppArtifact` 会拒绝 IPA 路径穿越、符号链接、非唯一 `Payload/*.app`、Simulator-only 构建、非 arm64、bundle ID 不匹配和无效签名。
- xcodebuild 构建与 devicectl 安装已分离；安装和启动由预检协调器在已确认 TestPlan 后执行。
- 已安装目标 App 的覆盖安装和 WDA 准备均接入 PermissionEngine 的 R7 确认。
- physical Appium backend 必须显式选择 Route B 或 Route C，不再接受隐式/preinstalled ready 路径。
- WDA 已安装清单只证明 `installed`；`ready` 必须来自绑定目标 UDID、WDA bundle ID 与显式路线的活动 Appium session/status 等价探针。
- WDA 修复后必须重新执行活动探针，不能沿用修复前结果。
- `bun run typecheck`：通过。
- `bun run lint`：通过，800 files checked。
- T6.4 定向契约、backend、engine 与 Phase 6 相关用例均通过。
- `git diff --check`：通过。

受限沙箱内测试曾因 Keychain、默认 `~/.itestagent`、CoreDevice 与本地端口隔离出现环境失败；按提交门禁在真实本机环境重跑后得到 3430 pass / 13 skip / 0 fail（322 files），确认这些失败不属于产品回归。

## 真实 iPhone WDA G5

首次在沙箱内执行 `xcrun devicectl list devices` 时，CoreDeviceService 的 XPC 连接失效并超时。2026-09-01 在用户连接设备并授权沙箱外只读探测后，成功发现一台已配对、Developer Mode 已启用、DDI services available 的 iPhone 14 Plus；设备名称与标识未写入报告。设备 App 清单中存在一个 WDA Runner，Appium 3.6.0 本地服务与 `iproxy` 均可用。

Route B 首次执行不重签、不重装的活动启动时，macOS Developer Tools developer mode 尚未启用，WDA Runner 虽已进入 `Running tests...`，但设备端 8100 未监听，`/status` connection refused。用户自行执行 `sudo DevToolsSecurity -enable` 后，按相同命令重新验证并通过：

- `xcodebuild test-without-building` 启动现有 WDA；
- `iproxy` 临时 tunnel 上 `/status` 返回 `ready: true`，并包含 WDA build identity；
- Appium 3.6.0 external-url session 创建成功；
- Settings UI tree：45,457 字符；截图：306,688 bytes；Home 动作成功；
- Appium session 删除成功；临时 tunnel 与 xcodebuild 进程已回收；
- 原始 UI tree 与截图仅保存在 `/tmp`，报告只记录长度与大小。

Route C 在用户明确确认可能发生 WDA 重建、重签和覆盖安装后，使用当前有效签名身份执行 Appium `managed-xcodebuild + allowProvisioningDeviceRegistration`。同标准结果：

- Appium session 创建成功；
- Settings UI tree：45,457 字符；截图：307,187 bytes；Home 动作成功；
- Appium session 删除成功，无独立 tunnel 需要清理；
- 设备、Team ID、WDA bundle ID 与原始 UI/截图均未写入报告。

两条 route 均证明：设备清单里的 WDA `installed` 不能直接产生 ready；ready 来自本轮 route-specific launch/session 与 `/status` 或等价 Appium session。初始 `/status` 不可达也被 fail-closed，而不是沿用 inventory 结果。

### 路线结论

初次正常路径验证曾将 Route C 记为候选偏好，依据是它不依赖独立 `iproxy`。PR review 后的 identity/abort 复验证明该依据不完整：Route C 会遗留 Appium-owned `xcodebuild`，而 Route B 正常与 abort 清理均无残留。因此当前候选偏好改为 **Route B**，Route C 保留为显式诊断路线，不允许静默 fallback。路线对比仍为 **partial**；必须在 DEF-033/T6.10 完成 Route C in-flight cancellation 与 child ownership 后，才能确定最终 production default。

### PR review 修复后真机复验

2026-09-01 对 PR review 修复重新执行同设备 Route B/C readiness 与 abort 探针，设备标识、Team ID 和 WDA bundle ID 仍不写入报告：

- Route B 首次复验揭示 Appium external-url session 不回传 `updatedWDABundleId`，仅依赖 Appium capabilities 会把可用 WDA 误判为 `unobserved`。实现改为从活动 WDA `/status.build.productBundleIdentifier` 观测 build identity，并在 `WdaManager.launch()` 向 XCTest runtime 传递与 build-for-testing 相同的 `WDA_PRODUCT_BUNDLE_IDENTIFIER`、签名和 DerivedData 设置。
- Route B 使用同一可追溯产物完成重建、覆盖安装、启动、临时 `iproxy`、Appium session 与 identity probe；最终 `ready=true`，活动 probe 约 1.0 秒，完整启动后验证约 6.1 秒。常规清理后没有残留 WDA xcodebuild、Appium session 或 tunnel。
- Route C 使用当前有效 Personal Team 重新验证，Appium session 返回的设备与 WDA identity 均匹配，`ready=true`，活动 probe 约 28.4 秒。但 session 删除成功后 Appium-owned `xcodebuild` 仍继续存活，已按本轮精确 PID 手工回收。
- Route B 在 probe 开始 100 ms 后触发 abort，约 0.9 秒后 fail-closed 返回，随后检查没有残留 xcodebuild 或 tunnel。
- Route C 在 probe 开始 100 ms 后触发 abort，约 8.5 秒后才返回，cleanup guard 又等待约 15 秒，Appium-owned `xcodebuild` 仍存活并需按本轮精确 PID 手工回收。

因此此次复验关闭了 Route B URL 接线、runtime WDA identity 观测和正常清理的不确定性，也获得 Route B abort 的正向证据；同时以真机证据确认 Route C 的 in-flight Appium cancellation 与 child-process ownership 仍未闭合。DEF-033 必须继续保持 open，路线对比仍为 **partial**，不得把 Route B 候选偏好升级为最终默认。

## App 构建/安装 G5

仓库没有业务 `.app/.ipa`。用户确认后使用 WDA 工程的 `IntegrationApp` scheme 构建真机测试 App，并指定当前有效 Team 的唯一 bundle ID。首次构建以 xcodebuild code 65 失败：CLI 环境报告 `No Accounts` 且缺少 provisioning profile。用户在 Xcode Accounts 登录后重试，xcodebuild 成功生成真机 `.app`。

在受限沙箱内执行 `codesign --verify --deep --strict` 曾返回 `CSSMERR_TP_NOT_TRUSTED`；同一产物在沙箱外严格校验成功，证明该次失败来自 Keychain 信任链隔离，未据此放宽生产契约。随后在沙箱外执行生产 `normalizePhysicalAppArtifact()`，得到 `sourceKind=build`、`iPhoneOS`、`arm64`、`signingValid=true`，设备清单确认目标 bundle 尚未安装，因此不会发生覆盖。

经用户此前确认，生产 `createDevicectlOps().installApp()` 执行首次安装，但设备返回 CoreDevice error 3002 / `This app cannot be installed because its integrity could not be verified`。安装后 inventory 明确为 false，没有残留 App，也没有执行 launch。进一步只读核验结果全部成立：profile 未过期、包含当前设备、匹配 bundle 与 Team、包含实际签名证书；实际证书存在、未过期且 macOS codeSign trust 成功。用户随后完成设备重启、解锁与 Developer App 验证；复验仍失败，但本轮保存的 CoreDevice 结构化恢复建议揭示真实原因：设备已达到免费开发者 profile 可安装 App 数量上限。外层完整性错误只是包装错误，并非剩余签名/profile 不匹配。

用户自行删除一个不再需要的免费开发者 App 释放名额后，本轮再次执行 fail-closed 前置检查：同一 App 产物存在、沙箱外严格签名校验仍通过、设备 App inventory 可读且目标 bundle 尚未安装。随后 devicectl 首次安装成功；安装后重新读取 inventory，精确匹配目标 bundle；devicectl launch 成功。iTestAgent 未覆盖、卸载或修改设备上的其他 App，至此完成同一真实 iPhone 上的构建产物归一化、安装和启动 G5 链路。

生产 devicectl 错误分类已补充：完整性拒绝明确归为签名/provisioning，并提示设备在线、解锁与 VPN & Device Management 信任；免费账号 App 上限明确提示不会自动卸载。由于 CoreDevice 会把免费账号上限包装在 `ApplicationVerificationFailed` 中，分类优先级已调整为优先采用更具体的 recovery suggestion，避免误导用户继续排查签名。

本机 DerivedData 中找到的旧真机 App 均未通过沙箱外 `codesign --verify --deep --strict`，按 `PhysicalAppArtifact` 的 fail-closed 规则不能复用。环境未安装 `xcbeautify`，本轮构建保留原始 xcodebuild 日志并显式记录该限制，没有伪装为已美化。

当前限制：

- 仓库没有独立业务 `.app/.ipa`，本轮以 WDA 工程的 `IntegrationApp` 验证通用真机安装/启动链路；真实业务 App 的签名、entitlements 与运行行为仍需在具体项目中验证；
- 环境未安装 `xcbeautify`，构建证据为原始 xcodebuild 日志。

## Verify 结论

App 与 WDA 两条正常真机主链路均已获得同设备主动 G5 证据：App 完成有效产物归一化、首次安装、inventory 复核和启动；WDA Route B/C 均完成主动 readiness、Appium session、UI source、截图、动作和常规清理。免费账号 App 数量上限的包装错误已转化为可操作且不自动卸载的诊断。两路线 abort 证据仍由 DEF-033/T6.10 收口，因此本报告不宣称最终默认路线。后续若再次安装当前目标，因为 inventory 已显示其存在，必须在覆盖前重新取得 R7 确认。

最终自动化复验：T6.4 相关定向用例均通过；全库 3430 pass / 13 skip / 0 fail；`bun run typecheck`、`bun run lint` 与 `git diff --check` 均通过。

DEF-031 的 installed-vs-ready 缺陷已有实现、自动化测试和同设备 Route B/C 主动 G5 证据，已关闭为 `resolved`。T6.4 正常路径的实现与 Verify 已完成；路线对比因 DEF-033/two-route abort 证据仍为 partial，任务继续保持 `in_progress`，不能据此宣称最终 production default 或直接标记 `done`。
