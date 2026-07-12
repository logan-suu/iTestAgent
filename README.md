# iTestAgent

> **iPhone 真机全自动化测试 TUI Agent — Local-first, TUI-first, Agent-native.**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

iTestAgent 是一个类似 [OpenCode](https://github.com/anomalyco/opencode) 的本地 TUI Agent，但领域不是代码开发，而是 **iPhone 真机全自动化测试**。

```
OpenCode：先理解代码项目，再决定如何开发、修改、验证
iTestAgent：先理解 iOS 项目，再决定如何进行 iPhone 真机测试
```

---

## 产品定位

iTestAgent 的核心不是"收到测试目标后直接乱点 UI"，而是：

1. **先理解项目** — 从代码、工程结构、业务模块、已有测试资产中充分理解 iOS 项目
2. **再生成策略** — 输出 Project Profile + 候选核心链路 + TestPlan
3. **驱动真机执行** — 在本机连接 iPhone 真机执行 XCUITest 或 Appium/WDA 探索
4. **采集证据分析失败** — 自动收集截图、视频、日志、crashlog、xcresult、trace
5. **输出本地报告** — summary.md + result.json + artifact-index.json

```
Local-first, TUI-first, Agent-native, Project-aware, Real-device only.
本地优先、TUI 优先、Agent 原生、先理解项目、只面向 iPhone 真机。
```

## 目标用户

**第一目标**：iOS 客户端开发者本地自测与失败复现。

**第二用户**：QA 和测试平台同学。第一版产品主线围绕单个开发者在本机连接 iPhone 真机完成自测、复现、性能采集和失败解释。

## 架构概览

```
交互层        itestagent-cli / itestagent-tui（OpenTUI+Solid）
编排层        itestagent-server / itestagent-engine / project-analyzer
能力适配层    itestagent-adapters（MCP tools）
工具与真机层  Xcode / Appium / WDA / xctrace / devicectl / iPhone 真机
存储与报告层  itestagent-store（SQLite + 文件系统 + 报告）
```

**两条执行路径**：
- **有 XCUITest** → `xcodebuild test` 标准路径
- **无测试代码** → Appium/WDA Agent Flow 探索路径（Agent 建议、用户确认、固化为可重放 Flow）

## 快速开始

> ⚠️ iTestAgent 当前处于 **Phase 0：立项与双 Spike** 阶段，尚未发布可安装版本。

### 前置依赖

- macOS + Xcode + Command Line Tools
- 支持开发者签名的 Apple ID
- iPhone 真机（iOS 16+）
- Bun ≥ 1.x
- OpenAI-compatible API Key

### 使用方式（规划）

```bash
# 在 iOS 项目目录中启动
cd /path/to/ios-project
itestagent

# 环境诊断
itestagent doctor

# 查看本机 iPhone
itestagent devices
```

```text
itestagent
> 这个项目没有测试代码，帮我探索登录流程并保存成 Flow
> 帮我用本机 iPhone 跑一下登录 smoke，并分析失败原因
> 对比上次结果，这个包启动有没有变慢
```

### MVP 完成标准（18 条）

1. 运行 `itestagent` 进入 OpenTUI 交互式 TUI
2. Agent 自动分析 iOS 项目并生成 Project Profile
3. `itestagent doctor` 环境诊断与引导
4. `itestagent devices` 设备发现与健康检查
5. 一句自然语言生成基于 Project Profile 的 TestPlan
6. 本地 server 管理长任务、事件流、session 状态
7. TUI 展示 TestPlan 并让用户确认
8. 有 XCUITest 时优先执行已有测试
9. 无测试代码时通过 Appium/WDA Agent Flow 探索执行
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
| TUI | OpenTUI + Solid |
| LLM | Vercel AI SDK + OpenAI-compatible provider |
| 工具协议 | MCP TypeScript SDK |
| 存储 | SQLite + Drizzle + 文件系统 |
| 配置 | JSONC |
| 真机执行 | Appium + XCUITest Driver + WebDriverAgent |
| 构建/设备 | xcodebuild / xcrun devicectl |
| 性能采集 | xcrun xctrace / XCTest metrics |
| 结果解析 | xcresultparser / xcparse |
| 签名/构建 | fastlane / xcbeautify |

## 复用策略

**直接采用**：OpenTUI / Vercel AI SDK / MCP TS SDK / Drizzle / Appium / XCUITest Driver / WebDriverAgent / XcodeProj / swift-syntax / sourcekit-lsp / xcresultparser / xcparse / xcbeautify / fastlane

**借鉴不依赖**：XcodeBuildMCP / XcodeTraceMCP / instruments-mcp-server / instruments-analyzer / Periphery / Maestro flow 语义

**必须自研**：Project Profile 语义模型、候选链路推断、TestPlan 编译、Agent 编排循环+权限引擎、iTestAgent Flow YAML、失败归因、本地 baseline 策略、TUI 交互体验

## 开发状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0 | 🔄 进行中 | 立项与双 Spike（端到端真机 + 元素定位） |
| Phase 1 | ⬜ 待开始 | 骨架与环境（TUI/Server/doctor/devices） |
| Phase 2 | ⬜ 待开始 | 项目分析与 TestPlan |
| Phase 3 | ⬜ 待开始 | 真机执行核心（双路径 + Flow） |
| Phase 4 | ⬜ 待开始 | 证据 / 性能 / 报告 |
| Phase 5 | ⬜ 待开始 | 打磨与 MVP 验收 |
| Phase 6+ | ⬜ 待开始 | 增强路线 |

预计单人全职约 **26-32 周**到 MVP。

## 项目结构

```
iTestAgent/
├── AGENTS.md              # 项目宪法（AI Agent 首先阅读）
├── task-status.json       # 任务追踪
├── .opencode/commands/    # OpenCode 自定义命令（14 条）
└── docs/                  # 规格文档
    ├── INDEX.md                                # 文档索引（Agent 首读）
    ├── 全量用户故事与验收标准规格书.md
    ├── 架构设计文档.md
    ├── 技术选型文档.md
    ├── 数据流全链路技术说明文档.md
    ├── AI Native 开发理念与实战技巧手册.md
    ├── 开发避坑与关键注意点手册.md
    └── 开发计划安排文档.md
```

## 开发约定

- **工作流**：EPCC-V（Explore → Plan → Code → Check → Verify）
- **质量门禁**：G1-G7（规格一致 / 契约校验 / 静态检查 / 测试通过 / 真机验证 / 证据留档 / 安全合规）
- **命名约定**：组件统一 `itestagent-*`，禁止 `qa-*`
- **红线**：不碰 Apple 私有框架、不自研已复用底座、真机必 spike 实测、不静默降级/臆造指标、敏感数据不落盘明文

## 硬红线（违反必被拒绝）

```
R1 不碰 Apple 私有框架（TraceUtility 等）与 .trace 二进制逆向
R2 不自研已复用底座：WDA / Appium / xcodebuild / xctrace / xcresult 解析
R3 真机能力不得"看代码就算过"，必须真机 spike 实测
R4 不把"从代码推断的核心链路"当既定事实，只能候选+证据+用户确认
R5 不静默降级/臆造指标（尤其 FPS、xctrace summary），不确定须显式标注
R6 敏感数据（账号/OTP/token）不落盘明文、不入日志/报告/提交
R7 高风险操作必须二次确认（清数据/卸载重装/写项目/存凭证/更新 baseline）
R8 未经人确认的实现计划不得进入编码
R9 组件命名统一 itestagent-*，禁止使用 qa-*
R10 不引入 Effect-TS / SQLite 事件溯源等重型编排；不 fork/import OpenCode 私有核心
```

## License

MIT
