# iTestAgent

> **iPhone 真机与 iOS Simulator 同级支持的全自动化测试 TUI Agent — Local-first, TUI-first, Agent-native.**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

iTestAgent 是一个类似 [OpenCode](https://github.com/anomalyco/opencode) 的本地 TUI Agent，但领域不是代码开发，而是 **iPhone 真机与 iOS Simulator 同级支持的全自动化测试**。

```
OpenCode：先理解代码项目，再决定如何开发、修改、验证
iTestAgent：先理解 iOS 项目，再决定如何进行真机或 Simulator 测试
```

---

## 产品定位

iTestAgent 的核心不是"收到测试目标后直接乱点 UI"，而是：

1. **先理解项目** — 从代码、工程结构、业务模块、已有测试资产中充分理解 iOS 项目
2. **再生成策略** — 输出 Project Profile + 候选核心链路 + TestPlan
3. **驱动执行** — 在本机连接 iPhone 真机或 iOS Simulator 执行 XCUITest 或 DeviceBackend 探索
4. **采集证据分析失败** — 自动收集截图、视频、日志、crashlog、xcresult、trace
5. **输出本地报告** — summary.md + result.json + artifact-index.json

```
Local-first, TUI-first, Agent-native, Project-aware, Target-explicit.
本地优先、TUI 优先、Agent 原生、先理解项目、真机与 iOS Simulator 同级支持、执行目标始终显式。
```

## 目标用户

**第一目标**：iOS 客户端开发者本地自测与失败复现。

**第二用户**：QA 和测试平台同学。第一版产品主线围绕单个开发者在本机连接 iPhone 真机或 iOS Simulator 完成自测、复现、性能采集和失败解释。

## 架构概览

```
交互层        itestagent-cli / itestagent-tui
编排层        itestagent-server / itestagent-engine / AgentRuntime
语义层        ProjectProfile / TestPlan / RunStep / Flow / ArtifactRef
Backend接口层  DeviceBackend / PerformanceBackend / BuildDriver / ProjectAnalyzerBackend
Backend实现层  mobile-mcp / Appium-WDA / iphone-use / XcodeTraceMCP / XcodeQuery / Drizzle
存储与报告层  SQLite metadata / filesystem artifacts / summary.md / result.json
```

**可插拔 Backend 架构（真机与 Simulator 同级，ADR-011）**：iTestAgent 定义稳定上层接口和产物模型，底层工具可替换。
- Device: `Appium/WDA`（MVP 主 backend）、`mobile-mcp`（强候选，需付费账号）、`iphone-use`（视觉 fallback）
- Performance: `@xctrace-analyzer/core`（MVP 默认）+ 自研 hitches parser + `raw xcrun`（fallback）
- TUI: `OpenTUI`（目标主线）、`Ink`（已验证 fallback）

## 快速开始

> iTestAgent 当前处于 **Phase 1：骨架与环境** 阶段，尚未发布可安装版本。

### 前置依赖

- macOS + Xcode + Command Line Tools
- 支持开发者签名的 Apple ID
- iPhone 真机（iOS 16+）或 iOS Simulator（Xcode 16+）
- Bun ≥ 1.x
- OpenAI-compatible API Key

### 使用方式（规划）

```bash
# 在 iOS 项目目录中启动
cd /path/to/ios-project
itestagent

# 环境诊断
itestagent doctor

# 查看本机设备（真机 + Simulator）
itestagent devices
```

```text
itestagent
> 这个项目没有测试代码，帮我探索登录流程并保存成 Flow
> 帮我用本机 iPhone 跑一下登录 smoke，并分析失败原因
> 对比上次结果，这个包启动有没有变慢
```

### MVP 完成标准（19 条，含 Simulator 同级支持）

1. 运行 `itestagent` 进入 OpenTUI 交互式 TUI
2. Agent 自动分析 iOS 项目并生成 Project Profile
3. `itestagent doctor` 环境诊断与引导
4. `itestagent devices` 设备发现与健康检查
5. 一句自然语言生成基于 Project Profile 的 TestPlan
6. 本地 server 管理长任务、事件流、session 状态
7. TUI 展示 TestPlan 并让用户确认
8. 有 XCUITest 时优先执行已有测试
9. 无测试代码时通过 DeviceBackend 探索执行
10. 根据项目生成安全测试数据或在 TUI 询问
11. 按断言策略判断 passed / explored / inconclusive / needs_assertion
12. 探索过程记录为 run steps 并保存为可重放 iTestAgent Flow
13. 失败时自动收集截图、视频、日志、.xcresult、.trace
14. 性能采集：launch time / memory / crash / test duration / hitches / FPS
15. 首次性能采集建立本地 baseline，后续输出对比趋势
16. 本地生成 summary.md、result.json、artifact-index.json
17. 失败解释并可重跑失败用例
18. 可生成 XCUITest/Appium 测试代码草稿（标记 draft，不自动入库）

## 技术栈

| 层级 | 选型 |
|---|---|
| 语言/运行时 | TypeScript + Bun |
| TUI | OpenTUI / Ink（横评完成） |
| LLM | Vercel AI SDK + OpenAI-compatible provider |
| 工具协议 | MCP TypeScript SDK |
| 存储 | SQLite + Drizzle + 文件系统 |
| 配置 | JSONC |
| 设备执行 | Appium + XCUITest Driver + WebDriverAgent（physical+simulator） |
| 构建/设备 | xcodebuild / xcrun devicectl / simctl |
| 性能采集 | xcrun xctrace / XCTest metrics |
| 结果解析 | xcresultparser / xcparse |
| 签名/构建 | fastlane / xcbeautify |

## 复用策略

**直接采用**：OpenTUI / Vercel AI SDK / MCP TS SDK / Drizzle / Appium / XCUITest Driver / WebDriverAgent（physical+simulator）/ XcodeProj / swift-syntax / sourcekit-lsp / xcresultparser / xcparse / xcbeautify / fastlane / simctl

**借鉴不依赖**：XcodeBuildMCP（参考项目）/ XcodeTraceMCP（参考项目，npm 包为 `@xctrace-analyzer/core`）/ instruments-mcp-server（录制参考，非可信分析）/ instruments-analyzer / Periphery / Maestro flow 语义

**必须自研**：Project Profile 语义模型、候选链路推断、TestPlan 编译、Agent Harness Runtime（AgentRuntime/PermissionEngine/RunStateMachine/ToolDispatcher/ContextBuilder，ADR-010）、iTestAgent Flow YAML、失败归因、本地 baseline 策略、TUI 交互体验

## 开发状态

### 能力成熟度（Designed → Contracted → Implemented → Verified）

| 能力 | 成熟度 | 说明 |
|---|---|---|
| CLI 入口 + 配置 | ✅ Verified | `itestagent --version`/`config` 可用 |
| TUI Shell 骨架 | ✅ Verified | OpenTUI+SolidJS，TTY 检测正常 |
| Harness 核心接口契约 | ✅ Contracted | 14 Zod schemas + 5 Backend interfaces |
| RunStateMachine / PermissionEngine | 📋 Designed | 接口已定义，实现待 Phase 1.4+ |
| Server / SessionManager / SSE | 📋 Designed | 接口已定义，实现待 Phase 1.5a-c |
| doctor 环境诊断 | 📋 Contracted | Schema 已定义，实现待 Phase 1.6a-b |
| devices 设备发现 | 📋 Contracted | Schema 含 targetKind，实现待 Phase 1.7 |
| Project Profile / TestPlan | 📋 Designed | 架构已定，实现待 Phase 2 |
| AgentRuntime / Backend 执行 | 📋 Designed | 接口已定义，实现待 Phase 3 |
| 证据采集 / 性能 / 报告 | 📋 Designed | 接口已定义，实现待 Phase 4 |

**成熟度定义**（ADR-011 审计建议）：
- 📋 **Designed** — 规格/ADR 已确定，接口已定义，但无实现
- 📜 **Contracted** — Zod schema + 测试已通过，实现按接口接入
- 🔧 **Implemented** — 实现代码完成，单元测试通过
- 🔗 **Integrated** — 跨模块联调通过，集成测试通过
- ✅ **Verified** — 真机 G5 或 Simulator G5-SIM spike 验证通过

### 阶段状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 | ✅ 完成 | 立项与多 Backend 横评（端到端真机 + 元素定位） |
| Phase 1 | 🔄 in_progress | 骨架与环境（CLI/TUI/contracts done, RunStateMachine/Server/doctor/devices/store/config pending） |
| Phase 2 | ⬜ 待开始 | 项目分析与 TestPlan |
| Phase 3 | ⬜ 待开始 | 真机+Simulator 执行核心（双路径 + Flow） |
| Phase 4 | ⬜ 待开始 | 证据 / 性能 / 报告 |
| Phase 5 | ⬜ 待开始 | 打磨与 MVP 验收 |
| Phase 6+ | ⬜ 待开始 | 增强路线 |

预计单人全职约 **28-36 周**到 MVP（含 Simulator 同级支持 7-10 人周增量）。

## 项目结构

```
iTestAgent/
├── AGENTS.md              # 项目宪法（版本/红线/Git 规范/EPCC-V/Agent 自检清单）
├── .opencode/commands/    # OpenCode 自定义命令（14 条）
├── packages/              # 工作区包（每个包含 src/ 生产代码 + test/ 单元测试）
├── schemas/               # JSON Schema（config/project-profile/test-plan/result/artifact-index/flow）
├── fixtures/              # 测试数据（device-responses/mobile-mcp/appium/xctrace/xcresult）
├── tests/
│   └── integration/       # 跨包集成测试（Phase 验收级）
└── docs/
    ├── INDEX.md
    ├── 01-spec/            # 规格与需求
    │   └── 全量用户故事与验收标准规格书.md
    ├── 02-architecture/    # 架构设计
    │   ├── 架构设计文档.md
    │   ├── 技术选型文档.md
    │   └── 数据流全链路技术说明文档.md
    ├── 03-implementation/  # 开发避坑
    │   └── 开发避坑与关键注意点手册.md
    ├── 04-ai-native/       # AI Native 开发
    │   └── AI Native 开发理念与实战技巧手册.md
    └── 05-planning/        # 开发计划
        ├── 开发计划安排文档.md
        └── task-status.json
    └── decisions/          # 架构决策记录（ADR）
```

## 开发约定

- **工作流**：EPCC-V（Explore → Plan → Code → Check → Verify）
- **质量门禁**：G1-G7+G5-SIM（规格一致 / 契约校验 / 静态检查 / 测试通过 / 真机验证(G5) / Simulator验证(G5-SIM) / 证据留档 / 安全合规）
- **命名约定**：组件统一 `itestagent-*`，禁止 `qa-*`
- **红线(R1-R12)**：不碰 Apple 私有框架、不自研已复用底座、真机+Simulator必spike实测、不静默降级/臆造指标、敏感数据不落盘明文、对外内容必英文
- **决策**：重大技术决策与需求变更必须记录到 `docs/decisions/`（ADR 格式）

## 硬红线（违反必被拒绝）

```
R1 不碰 Apple 私有框架（TraceUtility 等）与 .trace 二进制逆向
R2 不自研已复用底座：WDA / Appium / xcodebuild / xctrace / xcresult 解析
R3 真机能力不得"看代码就算过"，必须真机 spike 实测(G5)；Simulator 能力必须 Simulator spike 验证(G5-SIM，ADR-011)
R4 不把"从代码推断的核心链路"当既定事实，只能候选+证据+用户确认
R5 不静默降级/臆造指标（尤其 FPS、xctrace summary），不确定须显式标注
R6 敏感数据（账号/OTP/token）不落盘明文、不入日志/报告/提交
R7 高风险操作必须二次确认（清数据/卸载重装/写项目/存凭证/更新 baseline）
R8 未经人确认的实现计划不得进入编码
R9 组件命名统一 itestagent-*，禁止使用 qa-*
R10 不引入 Effect-TS / SQLite 事件溯源等重型编排；不 fork/import OpenCode 私有核心
R11 重大技术决策与需求变更必须记录到 docs/decisions/（ADR 格式），口头决策无效
R12 所有对外可见的版本控制内容必须使用英文；项目文档（docs/ 目录）除外
```

## License

MIT
