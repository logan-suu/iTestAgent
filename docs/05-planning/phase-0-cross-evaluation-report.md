# Phase 0 横评报告 + 决策矩阵

**日期**: 2026-07-15
**状态**: 完成
**任务**: T0.6 技术验证结论
**关联**: ADR-001~009、T0.1~T0.5 横评文档

---

## 1. 执行摘要

Phase 0 对 iTestAgent 各层 backend 进行了 5 轮横评（T0.1~T0.5），覆盖 Device / Performance / TUI / Project Analyzer 四层，在 2 台电脑（公司 + 个人）、2 台真机（iPhone 12 / iOS 16.4 + iPhone 14 Plus / iOS 18.2.1）上实测。所有横评任务已完成，决策矩阵确定，Phase 0 出口通过，可进入 Phase 1 骨架与环境。

**核心结论**: Appium/WDA 免费账号可用（含 workaround），是 MVP DeviceBackend 主路径。其余各层均有明确选型，无阻塞项。

---

## 2. 决策矩阵

### 2.1 总览

| 层 | MVP 主 backend | CI/no-device | 强候选（后置） | Fallback | ADR |
|---|---|---|---|---|---|
| **Device** | Appium/WDA | MockBackend | mobile-mcp（需付费账号） | iphone-use（Phase 6+ 视觉） | ADR-006 |
| **Performance** | xctrace-analyzer-core + 自研 hitches parser | — | — | raw xcrun | ADR-007 |
| **TUI** | OpenTUI+SolidJS（目标主线） | Ink（已验证 fallback） | — | Rezi 已排除 | ADR-008 |
| **Project Analyzer** | raw xcodebuild + Tuist/XcodeProj | — | XcodeQuery（optional future） | — | ADR-009 |
| **Build** | xcodebuild + xcbeautify | — | — | fastlane（签名复杂时） | ADR-005 |
| **Store** | Drizzle + bun:sqlite | — | — | Kysely / raw bun:sqlite | ADR-005 |
| **Agent Runtime** | AI SDK + MCP TS SDK | — | — | Mastra / LangGraph | ADR-005 |

### 2.2 详细评分

#### Device (T0.2 + T0.2b)

| Backend | 设备发现 | 截图 | UI tree | Tap | 免费账号 | 独特能力 | 总分 |
|---|---|---|---|---|---|---|---|
| **Appium/WDA** | ✅ | ✅ 305KB | ✅ 49596 chars | ⏳ 待补 | ✅ workaround | — | 5/5 |
| **MockBackend** | ✅ fixture | ✅ fixture | ✅ fixture | ✅ fixture | N/A | CI baseline | 5/5 |
| mobile-mcp | ✅ 568 apps | ❌ 需 agent | ❌ 需 agent | ❌ 需 agent | ❌ 需付费 | WebView/FS/Crash/Remote/MCP-native | 3/5 |
| iphone-use | N/A | N/A | N/A | N/A | N/A | 视觉 fallback | 2/5 |

#### Performance (T0.3)

| Backend | Time Profiler | Network | Hitches | Allocations/Leaks | R5 合规 | 结论 |
|---|---|---|---|---|---|---|
| **xctrace-analyzer-core** | ✅ | ✅ 906 requests | ❌ 需自研 parser | ✅ `not_exportable` | ✅ | MVP 默认 |
| **自研 hitches parser** | — | — | ✅ hitches-summary 第一版 | — | ✅ | 内部模块 |
| instrumentsmcp | ✅ | ❌ 报 0（漏报） | ❌ 报 "No hitches"（漏报） | ❌ 报 "0 allocations"（误导） | ❌ | 录制/report 参考，非可信 |
| raw xcrun | ✅ 23 schema | ✅ 数百行 | ✅ 49 行 hitches-summary | ✅ TOC 暴露 | ✅ | fallback |

#### TUI (T0.4 + T0.4b)

| Candidate | install | import | event model | stream render | Markdown | tool card | build | interactive shell | Total | 结果 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Ink** | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 16/16 | ✅ Pass |
| **OpenTUI** | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 0 | 9/16 | Partial（T0.4b 解决 build） |
| Rezi | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/16 | ❌ 不存在为 TUI 框架 |

#### Project Analyzer (T0.5)

| Candidate | 可用性 | 证据 | 评分 | 结论 |
|---|---|---|---|---|
| **raw xcodebuild** | ✅ | `-list -json` / `-showBuildSettings -json` exit 0 | 9/10 | Apple 官方事实源 |
| **Tuist/XcodeProj** | ✅ | SwiftPM resolve/build/run；4 targets / 9 source refs / 16 resource refs | 8/10 | Graph + phase facts |
| XcodeQuery | ❌ | `which xcodequery` exit 1 | 3/10 | optional future |

---

## 3. 横评环境

| 项 | 公司电脑 | 个人电脑 |
|---|---|---|
| 用途 | T0.2 主横评（Appium/WDA） | T0.2b 补充（mobile-mcp + Appium/WDA 免费账号） |
| 设备 | iPhone 12 / iOS 16.4 | iPhone 14 Plus / iOS 18.2.1 |
| UDID | 00008101-... | 00008110-0012690901C1401E |
| Xcode | — | 26.5 (17F42) |
| 开发者账号 | 企业（付费） | 个人（免费） |
| Appium | 3.5.2 + xcuitest 11.17.3 | 3.5.2 + xcuitest 11.17.6 |
| mobilecli | N/A | 0.3.86 |

---

## 4. 关键发现

### 4.1 Appium/WDA 免费账号可用（T0.2b 重大发现）

WDA 默认 bundle ID `com.facebook.WebDriverAgentRunner.xctrunner` 已被 Facebook 注册，免费账号无法使用。Workaround：

1. 手动 `xcodebuild` 加 `-allowProvisioningUpdates` + 改 `PRODUCT_BUNDLE_IDENTIFIER` 为 `TEAMID.WebDriverAgentRunner.xctrunner`
2. Appium 用 `usePrebuiltWDA: true` + `updatedWDABundleId`
3. 免费 profile 7 天过期需定期重建

**影响**: 降低 iTestAgent 使用门槛——不需要 $99/年付费开发者账号。

### 4.2 mobile-mcp 免费账号不可用

mobilecli 下载预编译 IPA + 手动重签，需通配符 profile。免费账号无法创建通配符 profile → Catch-22。mobilecli 硬编码 agent bundle ID，不可覆盖。

**影响**: mobile-mcp 保留为强候选，待用户获取付费账号后补测 screenshot/UI tree/tap。

### 4.3 instrumentsmcp 数据诚信问题（R5）

instrumentsmcp 在 Network（报 0）、Hitches（报 "No hitches"）、Allocations（报 "0 allocations"）上均有漏报或误导。不可导出时报 0/ok，违反 R5「不静默降级/臆造指标」。

**影响**: instrumentsmcp 降级为"录制/report 参考"，不作为默认可信 PerformanceBackend。

### 4.4 自研 hitches parser 无公开替代

真实 trace 中的 schema（`hitches-summary` / `hitches-lifetime-interval` / `hitches-render-interval` / `hitches-gpu-interval` / `hitches-commit-interval`）与现有公开工具（instruments-analyzer、agent-device、SwiftUI-Agent-Skill）的 schema 名不同，不能直接复用。

**影响**: iTestAgent 需自研 hitches parser 作为内部模块。第一版只解析 `hitches-summary`（count、max duration、severity），Phase 4 实现。

### 4.5 Rezi 不存在为 TUI 框架

npm `rezi@1.0.0` 是 2015 年发布的 CSS post-processor，非 TUI 框架。`@rezi/core` 返回 404。

**影响**: TUI 候选从 3 个减为 2 个（OpenTUI + Ink），但不影响 M0 出口（Ink 16/16 满足）。

### 4.6 OpenTUI 标准构建问题可解

标准 `bun build` 因 `@opentui/core-*` optional native dynamic imports 失败。T0.4b 证明 OpenCode-style build pattern（`bun install --os="*" --cpu="*"` + Solid Bun plugin + `target: "bun"`）可解。

**影响**: OpenTUI+SolidJS 作为目标主线，Ink 兜底。

### 4.7 devicectl 与 xcdevice 状态不一致

`devicectl` 显示 `unavailable`，`xcdevice` 显示 `available`。不能只用 `devicectl` 否定设备可用性。

**影响**: T1.4 doctor 需同时检查 `devicectl` 和 `xcdevice`。

---

## 5. Phase 0 出口标准检查

| 出口标准 | 状态 | 证据 |
|---|---|---|
| 至少一路 DeviceBackend 在真机跑通截图+UI tree | ✅ | Appium/WDA: iPhone 14 Plus, page source 49596 chars + screenshot 305KB |
| MockBackend 可用 | ✅ | fixture + TDD 3 pass |
| PerformanceBackend 选型确定 | ✅ | xctrace-analyzer-core + 自研 hitches parser + raw xcrun |
| TUI 至少一路跑通交互式 Shell | ✅ | Ink 16/16, pseudo-TTY interactive shell |
| Project Analyzer 选型确定 | ✅ | raw xcodebuild + Tuist/XcodeProj |
| 决策矩阵输出 | ✅ | 本报告 §2 |
| 所有决策记录为 ADR | ✅ | ADR-006~009 |

**Phase 0 出口通过。**

---

## 6. 后置补测项（不阻塞 Phase 1）

| 补测项 | 条件 | 关联任务 |
|---|---|---|
| mobile-mcp screenshot/UI tree/tap | 付费 Apple Developer Program | 后置，不阻塞 Phase 1 |
| Appium/WDA tap/swipe/type | 真机允许执行交互操作 | Phase 3 T3.3c |
| OpenTUI 交互式 shell | 补齐 long-log/Markdown/tool-card/keymap | Phase 1 T1.2 |
| dSYM symbolication | xctrace symbolicate 验证 | Phase 4 T4.3 |
| hitches parser 多表关联 | 第二版实现 | Phase 4 |

---

## 7. Phase 1 准入清单

进入 Phase 1（骨架与环境）前需确认：

- [x] Phase 0 全部 6 个任务 done
- [x] ADR-006~009 记录完毕
- [x] 架构/技术选型文档同步更新
- [x] AGENTS.md §4 仓库结构与架构 §10 对齐
- [x] Bun 1.3.14 可用
- [x] monorepo 脚手架就位（18 包 + 5 schema + fixtures + mocks）

**Phase 1 ready。**

Phase 1 任务（依赖 T0.6 done 后级联为 ready）：
- T1.1 CLI 入口 + 版本/配置
- T1.2 TuiShell 交互式 Shell 骨架（OpenTUI 目标 / Ink fallback）
- T1.3 本地 Server + SSE + AgentRuntime
- T1.3b 核心 Backend 接口与数据契约
- T1.4 doctor 环境诊断（含 WDA 免费账号 workaround 引导）
- T1.5 devices 设备发现 + healthcheck（含 devicectl + xcdevice 双检查）
- T1.6 存储骨架 SQLite/Drizzle
- T1.7 配置分层 JSONC + Keychain
- T1.8 Phase 1 集成测试

---

## 8. 参考

### 横评文档

- `~/Desktop/横评/T0.2 Device backend 横评.md` — 公司电脑 Appium/WDA + Mock + iphone-use
- `~/Desktop/横评/T0.2b mobile-mcp 横评补充.md` — 个人电脑 mobile-mcp + Appium/WDA 免费账号
- `~/Desktop/横评/T0.3 Performance backend 横评.md` — 三路 + hitches parser 全网搜索
- `~/Desktop/横评/T0.4 TUI backend 横评.md` — 三路 + T0.4b OpenTUI 补充
- `~/Desktop/横评/T0.5 Project analyzer backend 横评.md` — 两路

### ADR

- `docs/decisions/ADR-006` — DeviceBackend 选型
- `docs/decisions/ADR-007` — PerformanceBackend 选型
- `docs/decisions/ADR-008` — TuiShell 选型
- `docs/decisions/ADR-009` — ProjectAnalyzerBackend 选型

### 前置 ADR

- `docs/decisions/ADR-001` — MVP 去风险定位
- `docs/decisions/ADR-002` — 核心链路不自动断定
- `docs/decisions/ADR-003` — 性能指标策略
- `docs/decisions/ADR-004` — 报告三件套
- `docs/decisions/ADR-005` — 可插拔 Backend 架构
