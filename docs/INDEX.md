# iTestAgent 项目文档索引

> 本文档供 AI Agent（OpenCode 桌面版）及人类开发者快速定位项目文档。
> 所有规格文档位于 `docs/` 目录下，按类别分 7 个子目录。冲突时以 `AGENTS.md` 为最高优先级。
> **Agent 使用指引**：启动时读取本文件建立全局认知；执行任务前根据 `AGENTS.md` §1 按需读取具体文档章节。

---

## 📁 文档目录

| 类别 | 子目录 | 文件 | 核心内容 |
|---|---|---|---|
| **规格与需求** | `01-spec/` | `全量用户故事与验收标准规格书.md` | 20 个 Epic、US-x.y + AC、MVP 19 条验收标准 |
| **架构设计** | `02-architecture/` | `架构设计文档.md` | 分层架构、组件职责、Agent 编排内核、权限引擎、数据模型、关键流程 |
| **技术选型** | `02-architecture/` | `技术选型文档.md` | 各层选型决策、候选对比、复用矩阵（采用/借鉴/排除） |
| **数据流全链路** | `02-architecture/` | `数据流全链路技术说明文档.md` | S1-S9 数据契约与落盘、端到端数据流示例 |
| **开发避坑** | `03-implementation/` | `开发避坑与关键注意点手册.md` | 红线详解、高风险坑 Top8、真机/Simulator/签名/backend 陷阱、提交前自检清单 |
| **AI Native 开发** | `04-ai-native/` | `AI Native 开发理念与实战技巧手册.md` | EPCC-V 工作流、上下文工程、质量门禁 G1-G7+G5-SIM、反模式 |
| **验证与 Spike** | `06-verification/` | `phase-0-cross-evaluation-report.md`、`g5-sim-spike-report-*.md` | 多 Backend 横评报告、G5/G5-SIM 真机与 Simulator 验证证据
| **开发计划** | `05-planning/` | `开发计划安排文档.md` | Phase 0-6+ 里程碑、任务拆解、单人排期（~28-36 周） |
| **任务状态** | `05-planning/` | `task-status.json` | 7 个 Phase 69 个任务、依赖关系、当前进度 |
| **Spike 验证 / G5/G5-SIM 报告** | `06-verification/` | phase-0-cross-evaluation-report.md / g5-sim-spike-report-*.md | Phase 0 横评结论、Simulator/真机 G5-SIM 验证证据 |
| **架构决策** | `decisions/` | `ADR-001~011` | 重大技术决策与需求变更记录（含 ADR-011 iOS Simulator 同级支持） |
| **项目宪法** | 仓库根目录 | `../AGENTS.md` | 红线 R1-R12、命名约定、EPCC-V 工作流、质量门禁 G1-G7+G5-SIM |

---

## 🔍 按模块快速定位

| 如果你需要... | 请查阅... |
|---|---|
| 用户故事与 AC（哪个 US 在做什么） | `01-spec/全量用户故事与验收标准规格书.md` E1~E20 |
| MVP 19 条完成标准 | `01-spec/全量用户故事与验收标准规格书.md` MVP 验收总表 |
| 第一版明确不做的事 | `01-spec/全量用户故事与验收标准规格书.md` 第一版明确不做 |
| 架构分层（CLI/TUI/Server/Engine/DeviceBackend/Store） | `02-architecture/架构设计文档.md` §2~3 |
| Agent 编排循环 + 权限引擎 | `02-architecture/架构设计文档.md` §4 |
| Harness Runtime 边界（自研/复用/禁止） | `decisions/ADR-010-agent-harness-runtime-boundary.md` |
| Harness Event Model + Abort/子进程 | `02-architecture/架构设计文档.md` §7.4~7.5 |
| 运行时原语复用约束 | `02-architecture/技术选型文档.md` §6.1 |
| Agent Session 模型 | `02-architecture/架构设计文档.md` §4.1 |
| Run 状态机（created → done） | `02-architecture/架构设计文档.md` §7 |
| 必须支持的本地能力清单 | `02-architecture/架构设计文档.md` §7 |
| 技术栈总览（TS/Bun/OpenTUI/AI SDK/MCP/Drizzle） | `02-architecture/技术选型文档.md` §3 |
| GitHub Repo 复用推荐（最推荐/借鉴/不用） | `02-architecture/技术选型文档.md` §12 |
| xctrace/.trace 解析策略 | `02-architecture/技术选型文档.md` §11 |
| 数据流 S1-S9 全链路契约 | `02-architecture/数据流全链路技术说明文档.md` §4~12 |
| Project Profile 数据契约 | `02-architecture/数据流全链路技术说明文档.md` §5 |
| TestPlan plan.yaml 契约 | `02-architecture/数据流全链路技术说明文档.md` §6 |
| result.json / artifact-index.json 契约 | `02-architecture/数据流全链路技术说明文档.md` §12 |
| 敏感数据流与脱敏规则 | `02-architecture/数据流全链路技术说明文档.md` §15 |
| EPCC-V 工作流详解 | `04-ai-native/AI Native 开发理念与实战技巧手册.md` §5 |
| AI 反馈模板（实现/评审/调试） | `04-ai-native/AI Native 开发理念与实战技巧手册.md` §7 |
| 红线 R1-R12 详解 | `03-implementation/开发避坑与关键注意点手册.md` §1 |
| 真机/Simulator/签名/backend 首次跑通地狱 | `03-implementation/开发避坑与关键注意点手册.md` §3 |
| Simulator 性能误导与端口冲突 | `03-implementation/开发避坑与关键注意点手册.md` §2(P8) |
| 探索式测试 + 断言不可靠陷阱 | `03-implementation/开发避坑与关键注意点手册.md` §4 |
| 项目分析 / AI 过度自信陷阱 | `03-implementation/开发避坑与关键注意点手册.md` §5 |
| 性能采集 / FPS / xctrace 维护税 | `03-implementation/开发避坑与关键注意点手册.md` §6 |
| 安全与隐私合规红线 | `03-implementation/开发避坑与关键注意点手册.md` §10 |
| 提交前自检清单 | `03-implementation/开发避坑与关键注意点手册.md` §16 |
| iOS Simulator 同级支持（ADR-011） | `decisions/ADR-011-ios-simulator-first-class-support.md` |
| Phase 0 横评 / G5-SIM 验证报告 | `06-verification/phase-0-cross-evaluation-report.md` / `06-verification/g5-sim-spike-report-*.md` |
| 可行性分析 + MVP 分档 | `03-implementation/开发避坑与关键注意点手册.md` §15 |
| 测试文件存放约定（单元/集成/数据） | `../AGENTS.md` §10 |
| Phase 0-6+ 里程碑与时间线 | `05-planning/开发计划安排文档.md` §2~8 |
| 当前开发任务与进度 | `05-planning/task-status.json` |

---

## 📊 Epic / 模块概览

| Epic | 名称 | US 范围 | MVP 优先级 |
|---|---|---|---|
| E1 | 安装与环境诊断（doctor） | US-1.1~1.3 | P0 |
| E2 | 设备发现与真机准备（含 Simulator） | US-2.1~2.3 | P0 |
| E3 | 项目分析与 Project Profile | US-3.1~3.3 | P0 |
| E4 | TUI 交互与 Agent 会话 | US-4.1~4.3 | P0 |
| E5 | TestPlan 生成与确认 | US-5.1~5.2 | P0 |
| E6 | App 构建/安装/启动 | US-6.1~6.2 | P0 |
| E7 | 测试执行：XCUITest 路径 | US-7.1 | P0 |
| E8 | 测试执行：DeviceBackend 探索路径 | US-8.1~8.2 | P1 |
| E9 | iTestAgent Flow（录制与重放） | US-9.1~9.2 | P0 |
| E10 | 测试数据与账号 | US-10.1~10.2 | P0/P1 |
| E11 | 断言策略 | US-11.1 | P1 |
| E12 | 性能采集与 baseline | US-12.1~12.2 | P0/P1 |
| E13 | 证据采集 | US-13.1 | P0 |
| E14 | 失败归因与解释 | US-14.1 | P1 |
| E15 | 报告输出 | US-15.1 | P0 |
| E16 | 重跑与会话延续 | US-16.1 | P0 |
| E17 | Agent 编排循环与权限引擎 | US-17.1~17.2 | P0 |
| E18 | 配置与安全 | US-18.1~18.3 | P0 |
| E19 | 本地存储与数据模型 | US-19.1 | P0 |
| E20 | 测试代码草稿生成 | US-20.1 | P2 实验性 |

---

## 🏗️ 架构核心速查

| 组件 | 定位 | 文档参考 |
|---|---|---|
| **itestagent-cli** | 轻量命令入口（doctor/devices/config/version） | `02-architecture/架构设计文档.md` §3 |
| **itestagent-tui** | 核心产品界面 / 交互式 Agent Shell（OpenTUI/Ink） | `02-architecture/架构设计文档.md` §3 |
| **itestagent-engine** | 编排引擎 / Agent 循环 / 权限引擎 / RunStateMachine / ToolDispatcher / ContextBuilder / TestPlan 编译 / 失败归因（ADR-010；runner 为内部运行角色，非独立包） | `02-architecture/架构设计文档.md` §3 |
| **itestagent-server** | 本地运行时服务 / SessionManager / SSE / subprocess controller | `02-architecture/架构设计文档.md` §3 |
| **itestagent-project-analyzer** | 项目分析 / Project Profile 生成 / 候选核心链路 | `02-architecture/架构设计文档.md` §3 |
| **DeviceBackend** | 真机与 Simulator 操作统一接口（listDevices/launchApp/tap/截图/UI tree） | `02-architecture/架构设计文档.md` §5.1 |
| **itestagent-store** | SQLite+Drizzle + 文件系统 + 报告 | `02-architecture/架构设计文档.md` §3 |

---

## 🔧 技术栈速查

| 层级 | 选型 | 文档参考 |
|---|---|---|
| 语言/运行时 | TypeScript + Bun | `02-architecture/技术选型文档.md` §4 |
| 交互 | CLI（Commander）+ TUI（OpenTUI/Ink 候选） | `02-architecture/技术选型文档.md` §5 |
| 编排/LLM | 自建循环 + Vercel AI SDK + OpenAI-compatible | `02-architecture/技术选型文档.md` §6 |
| 工具协议 | MCP TypeScript SDK | `02-architecture/技术选型文档.md` §7 |
| 存储 | SQLite + Drizzle + 文件系统 + JSONC 配置 | `02-architecture/技术选型文档.md` §8 |
| 设备执行 | DeviceBackend（Appium-WDA(physical+simulator) / mobile-mcp / iphone-use） | `02-architecture/技术选型文档.md` §9 |
| 项目分析 | XcodeProj + swift-syntax + sourcekit-lsp/SourceKitten | `02-architecture/技术选型文档.md` §10 |
| 性能采集 | xcrun xctrace / XCTest metrics / xcresultparser / xcparse | `02-architecture/技术选型文档.md` §11 |
| 辅助 | fastlane（签名/构建）/ xcbeautify（日志） | `02-architecture/技术选型文档.md` §9 |

---

## 📌 Agent 使用指引

1. **启动时**：读取本文件 + `../AGENTS.md`，了解文档全貌和红线约束
2. **执行任务前**：
   - 读取 `05-planning/task-status.json` 定位当前任务
   - 根据任务 `documents_required` 字段读取对应文档章节
   - 参考本索引"按模块快速定位"表补充上下文
3. **编码时**：遵循 EPCC-V（Plan → Code → Check → Verify）+ 红线 R1-R12
4. **遇到疑问**：回到本索引，确认是否遗漏了相关文档章节
5. **完成后**：执行 G1-G7+G5-SIM 质量门禁，更新 `05-planning/task-status.json`
6. **写测试时**：单元测试放 `packages/<pkg>/test/`，集成测试放 `tests/integration/`（`../AGENTS.md` §10）

---

**文档维护声明**
本索引与 iTestAgent 全量规格文档协同维护。当文档目录或结构发生变化时，需同步更新本文件。

**下次全面复审日期**：2026-08-01（与开发计划 Phase 0 结束同步）
