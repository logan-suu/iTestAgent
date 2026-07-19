# AGENTS.md

**版本**：v1.0
**生效日期**：2026-07-13
**适用对象**：所有参与 iTestAgent 项目开发的 AI Agent（OpenCode 桌面版 / Codex / Cursor / Claude）及人类开发者
**优先级**：本规约优先于任何 Agent 的默认行为。当本规约与 Agent 默认行为冲突时，以本规约为准。
**任务追踪**：`docs/05-planning/task-status.json` 记录所有任务执行状态
**延期待办**：`docs/05-planning/deferred-items.json` 集中追踪 PR review 中合理但延期的修复条目
**文档索引**：`docs/INDEX.md` 提供文档摘要与模块速查

---

## 0. 项目文档与快速索引

所有项目规格、架构、实现规范、AI Native 开发指南及计划均存放于 `docs/` 目录中。Agent 在执行任何编码任务前，**必须**先查阅相关文档并引用原文。

### 0.1 文档目录

| 文档类别 | 文件路径 | 用途 |
|---|---|---|
| **文档索引** | `docs/INDEX.md` | 文档摘要索引，Agent 启动时优先读取 |
| **规格与需求** | `docs/01-spec/全量用户故事与验收标准规格书.md` | 所有用户故事与 AC 的唯一来源 |
| **架构设计** | `docs/02-architecture/架构设计文档.md` | 分层/组件/编排内核/数据模型/流程 |
| **技术选型** | `docs/02-architecture/技术选型文档.md` | 各层选型决策、候选对比、复用矩阵 |
| **数据流全链路** | `docs/02-architecture/数据流全链路技术说明文档.md` | S1-S9 数据契约与落盘 |
| **开发避坑手册** | `docs/03-implementation/开发避坑与关键注意点手册.md` | 陷阱、防御性检查清单 |
| **AI Native 开发** | `docs/04-ai-native/AI Native 开发理念与实战技巧手册.md` | EPCC-V 工作流、质量门禁 G1-G7+G5-SIM、反模式 |
| **验证与 Spike** | `docs/06-verification/` | Phase 0 横评报告、G5/G5-SIM Spike 验证报告 |
| **开发计划** | `docs/05-planning/开发计划安排文档.md` | 里程碑、时间线及排期 |
| **任务状态** | `docs/05-planning/task-status.json` | 每个任务的执行状态、依赖关系 |
| **重大决策** | `docs/decisions/` | ADR 格式的架构决策与需求变更记录 |

### 0.2 任务类型 → 文档快速索引（Agent 必读）

**使用方式**：收到任务后，先判断任务类型，按下表确定应读取的文档和章节，使用 `read_file` 工具**只读取相关章节**（而非整篇文档）。

| 任务类型 | 应读取的文档 | 重点章节/关键词 |
|---|---|---|
| **初次启动/建立全局认知** | `docs/INDEX.md` | 全文阅读，建立文档地图 |
| **实现 CLI 入口** | `docs/02-architecture/架构设计文档.md` | §2~3 分层架构、CLI 组件 |
| | `docs/02-architecture/技术选型文档.md` | §5 CLI 与 TUI 选型 |
| **实现 TUI 交互** | `docs/02-architecture/架构设计文档.md` | §2~3 交互层 |
| | `docs/02-architecture/技术选型文档.md` | §5 OpenTUI/Ink |
| **实现 Server/Engine** | `docs/02-architecture/架构设计文档.md` | §4 核心流程、§3 组件职责 |
| | `docs/02-architecture/数据流全链路技术说明文档.md` | §3~12 数据流全链路 |
| | `docs/decisions/ADR-010-agent-harness-runtime-boundary.md` | Harness 边界：自研/复用/禁止 |
| **实现 Backend（Device/Performance/Build）** | `docs/02-architecture/架构设计文档.md` | §5 Backend 接口设计 |
| | `docs/02-architecture/技术选型文档.md` | §9 真机执行技术栈 |
| **实现 Project Analyzer / ProjectAnalyzerBackend** | `docs/02-architecture/架构设计文档.md` | §3 project-analyzer、§5.4 ProjectAnalyzerBackend |
| | `docs/02-architecture/技术选型文档.md` | §10 项目分析技术栈 |
| | `docs/03-implementation/开发避坑与关键注意点手册.md` | §5 AI 过度自信 |
| **实现 doctor / devices** | `docs/01-spec/全量用户故事与验收标准规格书.md` | E1/E2 |
| | `docs/03-implementation/开发避坑与关键注意点手册.md` | §3 真机/签名/backend |
| **实现 DeviceBackend 探索执行** | `docs/02-architecture/技术选型文档.md` | §9 真机执行 |
| | `docs/03-implementation/开发避坑与关键注意点手册.md` | §4 探索式测试 |
| **实现性能采集** | `docs/02-architecture/技术选型文档.md` | §11 性能采集 |
| | `docs/03-implementation/开发避坑与关键注意点手册.md` | §6 FPS/xctrace |
| **实现用户故事 US-X.Y** | `docs/01-spec/全量用户故事与验收标准规格书.md` | 定位到具体 US |
| | `docs/02-architecture/数据流全链路技术说明文档.md` | 对应 S 阶段 |
| **实现安全/脱敏** | `docs/03-implementation/开发避坑与关键注意点手册.md` | §10 安全与隐私 |
| | `docs/02-architecture/数据流全链路技术说明文档.md` | §15 敏感数据流 |
| **调试/避坑** | `docs/03-implementation/开发避坑与关键注意点手册.md` | 按问题类型查找 |
| **技术选型决策** | `docs/02-architecture/技术选型文档.md` | 对应章节 |
| **查阅开发计划/任务** | `docs/05-planning/开发计划安排文档.md` | 里程碑、时间线 |
| | `docs/05-planning/task-status.json` | 当前任务状态、依赖关系 |
| **查阅重大决策** | `docs/decisions/` | ADR-001~011 |
| **执行 Spike/验证任务** | `docs/06-verification/phase-0-cross-evaluation-report.md` | Phase 0 横评结构与结论 |
| | `docs/06-verification/g5-sim-spike-report-*.md` | G5-SIM 验证报告模板（环境、证据、风险、集成笔记） |

### 0.3 Agent 文档读取规范

1. **启动时**：Agent 自动加载本文件，并**必须**读取 `docs/INDEX.md` 以建立全局文档认知，同时读取 `docs/05-planning/task-status.json` 以确认当前任务状态。
2. **执行任务时**：根据 §0.2 的映射表确定需读取的文档和章节，精准读取。
3. **引用原文**：在回复中必须**逐字粘贴**相关 AC 原文或架构约束原文。
4. **禁止推断**：严禁使用"根据常规做法，我认为应该..."之类的推断。如果文档描述模糊，Agent 必须停止编码并向人类提出澄清问题。

---

### 0.4 一句话项目定位

iTestAgent 是一个**类似 OpenCode 的本地 TUI Agent**，但领域是 **iPhone 真机与 iOS Simulator 同级支持的全自动化测试**：先理解 iOS 项目，再生成测试计划，驱动本机真机或 Simulator 执行、采集证据、分析失败并输出本地报告。

```
Local-first, TUI-first, Agent-native, Project-aware, Target-explicit.
本地优先、TUI 优先、Agent 原生、先理解项目、真机与 iOS Simulator 同级支持、执行目标始终显式。
```

### 与 OpenCode 的类比

| OpenCode                 | iTestAgent                                              |
| ------------------------ | ------------------------------------------------------- |
| 面向代码开发             | 面向 iPhone 真机测试                                    |
| 先读项目代码再决定怎么改 | 先分析 iOS 项目再决定怎么测                             |
| Tool calls               | Xcode / DeviceBackend / xctrace / parser backends       |
| Plan / Todo              | Project Profile / TestPlan / RunPlan / iTestAgent Flow  |
| Diagnostics              | `itestagent doctor` / `itestagent devices` / env checks |
| Session                  | Project-aware Test Run Session                          |
| Workspace                | iOS project + connected iPhone + `~/.itestagent`        |
| Final answer             | summary.md / result.json / explain                      |

第一目标用户是 **iOS 客户端开发者本地自测与失败复现**。第二用户包括 QA 和测试平台同学，但第一版产品主线围绕单个开发者在本机连接 iPhone 真机完成自测、复现、性能采集和失败解释。

## 1. 规格来源（Single Source of Truth）

本仓库的"真理"来自 docs/ 文件夹下 7 份文档；实现与文档冲突时，先改文档或纠正实现，禁止放任漂移。

```
用户故事与验收标准 US-x.y + AC（AI 任务与验收单元）
架构设计文档       分层/组件/编排内核/数据模型/流程
技术选型文档       各层选型与采用/借鉴/自研/不用
数据流全链路       S1-S9 数据契约与落盘
AI Native 开发手册 EPCC-V 工作流、质量门禁 G1-G7
开发避坑手册       红线、高风险坑、提交前自检
开发计划安排       阶段/里程碑/单人排期
```

## 2. 硬红线（NEVER，违反必被拒绝）

```
R1 不碰 Apple 私有框架(TraceUtility 等)与 .trace 二进制逆向
R2 不自研已复用底座：WDA / Appium / xcodebuild / xctrace / xcresult 解析
R3 真机能力不得“看代码就算过”，必须真机 spike 实测(G5)；Simulator 能力必须 CoreSimulator runtime 端到端验证(G5-SIM，ADR-011)
R4 不把“从代码推断的核心链路”当既定事实，只能候选+证据+用户确认
R5 不静默降级/臆造指标(尤其 FPS、xctrace summary)，不确定必须显式标注
R6 敏感数据(账号/OTP/token)不落盘明文、不入日志/报告/提交
R7 高风险操作必须二次确认(清数据/卸载重装/写项目/存凭证/更新 baseline/覆盖 Flow/生成草稿)
R8 未经人确认的实现计划不得进入编码
R9 组件命名统一 itestagent-*，禁止使用 qa-*
R10 不引入 Effect-TS / SQLite 事件溯源等重型编排；不 fork/不 import OpenCode 私有核心
R11 重大技术决策与需求变更必须记录到 docs/decisions/（ADR 格式：背景、方案对比、决策、后果），口头决策无效
R12 所有对外可见的版本控制内容必须使用英文；项目文档（docs/ 目录）除外（§3.1.4 详述）
```

## 3. 技术栈（固定，不得随意替换）

```
语言/运行时   TypeScript + Bun
CLI          Commander（轻量入口）
TUI          OpenTUI / Ink（横评完成：OpenTUI 目标主线 + Ink 已验证 fallback，Rezi 已排除）
本地服务      Bun local server + 事件流(SSE)
编排          自建 Agent 循环 + Vercel AI SDK 多步 tool-calling
工具协议      MCP TypeScript SDK（真机能力封装为 MCP tools）
LLM          OpenAI-compatible provider（可扩展）
存储          SQLite + Drizzle（metadata）+ 文件系统（artifacts）
配置          JSONC（jsonc-parser）
真机执行      DeviceBackend 接口（mobile-mcp / Appium / iphone-use 等 backend 实现）
辅助          fastlane(签名/构建) / xcbeautify(日志) / pymobiledevice3(可选,子进程)
```

复用与自研边界：

```
直接采用   AI SDK / MCP SDK / SourceKit / XcodeProj / xcresultparser / xcparse / xcbeautify / fastlane
候选横评   OpenTUI+Ink / mobile-mcp+Appium+iphone-use / XcodeTraceMCP+instrumentsmcp+raw xcrun / Drizzle+Kysely / XcodeQuery+XcodeProj
借鉴不依赖 XcodeBuildMCP / instruments-analyzer / Periphery / Maestro flow 语义
必须自研   Project Profile 语义、候选链路、TestPlan 编译、编排循环+权限引擎、Flow、失败归因、baseline 策略、TUI 交互体验
```

## 3.1 Git 协作规范

### 3.1.1 分支命名

所有分支必须遵循 `{type}/{description}` 格式。Type 类型：

| Type | 说明 | 示例 |
|---|---|---|
| `feat` | 新功能 | `feat/cli-entry-point` |
| `fix` | Bug 修复 | `fix/doctor-signing-check` |
| `docs` | 文档更新 | `docs/update-agents-md` |
| `refactor` | 代码重构 | `refactor/engine-loop` |
| `test` | 测试 | `test/phase1-unit-tests` |
| `chore` | 构建/工具/依赖 | `chore/add-ci` |

分支策略：
- `main`：稳定发布分支，仅从 `dev-*` 合并而来，不直接接收功能 PR
- `dev-1.0`：开发集成分支，所有功能/修复 PR 的合并目标
- `{type}/{description}`：功能分支，PR base 为 `dev-1.0`（非 `main`）

**分支创建规则**：Agent 只在以下两种情况下创建新分支：
1. 执行 `/commit-pr-itest` 命令时（该命令包含分支检查与创建步骤）
2. 用户明确要求开分支（如"开个分支"、"新建分支做 X"）

除此之外，Agent 直接在当前分支上工作，**不主动切分支**。

### 3.1.2 Commit Message 格式

```
{type}({scope}): {subject}

{body}

Related: US-X.Y
```

Scope 使用组件名：`cli`、`tui`、`engine`、`server`、`backends`、`store`、`analyzer`、`docs`。

### 3.1.3 提交前强制自检

Agent 执行 `git commit` 前必须完成：
1. 运行 `bun run typecheck` — 0 错误
2. 运行 `bun run lint` — 0 违规
3. 运行 `bun test` — 全部通过
4. 更新 `docs/05-planning/task-status.json` 中任务状态
5. 确保无敏感数据提交（R6）

### 3.1.4 外部可见内容的语言规范（R12）

```
R12 所有对外可见的版本控制内容必须使用英文。项目文档（docs/ 目录）除外。
```

适用范围（必须用英文）：

| 内容类型 | 示例 | 说明 |
|---|---|---|
| **Git commit message** | title + body + footer | 含 `Related: US-X.Y` 可保留 US 编号 |
| **Git 分支名** | `feat/cli-entry-point` | 沿用 `{type}/{description}` 英文格式 |
| **PR 标题** | `feat(contracts): add harness core contracts [US-1.3]` | 英文描述 + US 编号 |
| **PR 描述/body** | AC coverage table, implementation summary | 完整英文 |
| **PR/Issue 评论** | review comments, replies, resolve notes | 完整英文 |
| **代码注释** | JSDoc, inline comments, TODO/FIXME | 完整英文 |
| **项目文档** | `docs/` 目录下所有 `.md` 文件 | **豁免：沿用中文** |

违反此规则的 commit/PR/评论必须修正后才能合并。

---

## 4. 架构与命名

分层（上层依赖下层，禁止反向）：

```
交互层  itestagent-cli / itestagent-tui
编排层  itestagent-server(SessionManager/SSE Hub/subprocess controller) / itestagent-engine(AgentRuntime/PermissionEngine/RunStateMachine/ToolDispatcher/BackendSelector/ContextBuilder) / itestagent-project-analyzer
语义层  ProjectProfile / TestPlan / RunStep / Flow / ArtifactRef
Backend接口层  DeviceBackend / PerformanceBackend / BuildDriver / ProjectAnalyzerBackend / StoreDriver
Backend实现层  mobile-mcp / Appium-WDA / iphone-use / XcodeTraceMCP / XcodeQuery / Drizzle / Kysely
工具层  Xcode / Appium / WDA / xctrace / devicectl / iPhone 真机
存储层  itestagent-store（SQLite + 文件系统 + 报告）

Harness 边界（ADR-010）：
- AgentRuntime 包装 AI SDK，负责 stream/event/abort，不直接执行设备命令
- PermissionEngine 是高风险操作唯一入口
- RunStateMachine 与 AgentRuntime 分离，不执行工具
- 同设备串行，不同设备并行
- abort 贯穿 runtime/tool/backend/child process，复用 AbortSignal/Bun.spawn
- 复用 AI SDK streamText/generateText/stopWhen/prepareStep、MCP TS SDK、UIMessage parts
- 禁止 fork OpenCode core、Effect-TS 全局编排、SQLite 事件溯源
```

命名约定：

```
- 组件一律 itestagent-*，禁止 qa-*
- core 不作为组件名；核心引擎叫 itestagent-engine
- engine 不直接拼底层命令，一律经 backend 接口
- backend 之间不互调，由 engine 编排
```

## 5. 目录、配置与数据契约

本地目录（唯一持久化根）：

```
~/.itestagent/
  config/itestagent.jsonc
  db/itestagent.db
  projects/<project-hash>/project-profile.json
  sessions/  flows/  baselines/
  runs/<run_id>/{plan.yaml,summary.md,result.json,artifact-index.json,artifacts/}
```

配置分层：`~/.itestagent/config/itestagent.jsonc` < 项目 `.itestagent/itestagent.jsonc` < `<project>/itestagent.jsonc`。

数据契约（必须带 schemaVersion，面向 schema 编码）：

```
project-profile.json  app/features(evidence+confidence)/testAssets/suggestedSmoke
plan.yaml             TestPlan：target/device/appSource/execution/features/testData/assertion/flows/metrics/performance/artifacts/report
result.json           run 状态/Profile 引用/设备/执行方式/metrics/baselineDelta/artifactRefs/explanation
artifact-index.json   artifacts[{id,type,path,relatedStep}]
```

报告固定三件套：`summary.md + result.json + artifact-index.json`，**不输出 report.html**。

## 6. 领域关键规则（务必内化）

```
执行路径   有 XCUITest -> xcodebuild test；无测试 -> DeviceBackend 探索
断言       用户明确条件 > Profile 目标 > Agent 建议(需确认) > 仅探索；无断言不判 passed(explored/inconclusive/needs_assertion)
性能       主推 hitches/hangs/launch/memory/crash/duration；FPS 标 approximate；xctrace summary 实验性(保留原始 .trace)
baseline   首次成功 run 建立；失败/crash 不建；后续对比趋势；接受新 baseline 需确认
数据       安全数据可 Agent 生成；真实账号/OTP/支付在 TUI 询问，只在内存注入，记住则进 Keychain
可复现     探索式默认不可复现，只有固化为 Flow 后可复现
写项目     默认不写项目目录，产物写 ~/.itestagent；写项目/存凭证/生成草稿需确认
```

## 7. 工作流：EPCC-V（每个任务必须遵循）

```
Explore  读相关文档章节 + 相关代码；Agent 先复述约束与现状(不写码)
Plan     产出实现计划(改哪些文件/接口/schema/测试)，等人确认
Code     小步实现，一次一个可验证单元
Check    类型检查 + Lint + 单测/集成测试
Verify   对齐 AC；真机能力走真机 spike 实测；证据留档
```

铁律：

```
- 未经人确认的计划不进入 Code(R8)
- 每个 Code 单元必须能被 Check 验证
- 真机相关必须 Verify 用真机 spike(G5)；Simulator 相关必须 G5-SIM(R3/ADR-011)；纯逻辑可用 mock+fixtures 但需说明
- 有代码变更必须同步更新相关文档，避免规格漂移
- 出现重大技术决策或需求变更时必须新增 ADR 记录到 docs/decisions/（R11）
- 若 Explore 阶段发现文档矛盾、模糊、不可测、依赖缺失或技术过时，Agent 必须暂停编码，报告问题并等待人类决策
```

## 8. 质量门禁 G1-G7+G5-SIM（并入主线前必过）

```
G1 规格一致  与 7 份文档不冲突
G2 契约校验  产物过 schema(plan/result/artifact-index/project-profile)
G3 静态检查  类型检查 + Lint 通过
G4 测试通过  覆盖对应 AC；P0 全绿
G5 真机验证  （真机）必须 real iPhone spike 实测（ADR-011）
G5-SIM Simulator 验证  涉及 Simulator 能力必须 CoreSimulator runtime 端到端验证（ADR-011）
G6 证据留档  自检报告逐条对 AC；不确定项显式标注
G7 安全合规  无敏感数据落盘明文；高风险操作有确认
```

## 8.1 任务状态机

所有任务状态记录在 `docs/05-planning/task-status.json` 中。

### 8.1.0 任务类型

```
代码类任务   产出代码、测试、schema，经 commit-pr-itest 创建 PR → 人类合并 → pr-merge-itest 标 done
非代码类任务 产出报告/验证/研究结论（spike/research/report），经人类确认后标 done（无 PR 流程）

非代码类产出文件存放约定：
- Phase 0 横评报告 → `docs/06-verification/phase-0-cross-evaluation-report.md`
- G5/G5-SIM Spike 验证报告 → `docs/06-verification/g5-sim-spike-report-{taskId}.md`
- 研究/调研笔记 → `docs/06-verification/` 中的对应文件
```

**两类任务共用同一状态机、同一终态，唯一区别是 `in_progress → done` 的确认方式不同。**

### 8.1.1 状态定义

```
pending -> ready -> in_progress -> done
```

| 状态 | 含义 | 谁可以变更 |
|---|---|---|
| `pending` | 任务已定义，依赖未满足 | 人类 |
| `ready` | 依赖已满足，等待执行 | Agent 自动（级联） |
| `in_progress` | 执行中；代码类任务已提交 PR 等待合并，非代码类任务已完成等待确认 | Agent 自动 |
| `done` | 代码类：PR 已合并到 dev-1.0；非代码类：人类已确认完成 | Agent 自动（经 `pr-merge-itest`） |

### 8.1.2 代码类任务 `in_progress → done` 转换规则

- 仅当 PR 已被人类手动合并到 dev-1.0 后，Agent 通过 `pr-merge-itest` 命令设为 `done`（§9.3：Agent 不得自动合并 PR）。
- `commit-pr-itest` 命令提交代码时**保持 `in_progress`**，仅记录 PR 链接到 `notes`，不得设为 `done`。

### 8.1.3 非代码类任务 `in_progress → done` 转换规则

- Agent 完成任务产出（报告/验证/研究）后，**保持 `in_progress`**，在 `notes` 中记录产出路径与结论摘要。
- 人类审阅确认后，Agent 通过 `pr-merge-itest` 命令设为 `done`（与代码类任务同一入口）。
- Agent **不得**在未经人类确认的情况下将非代码类任务标 `done`。

### 8.1.4 task-status.json 字段约束（R13）

```
R13 task-status.json 是纯任务追踪文件，禁止添加非任务字段。
```

**允许的顶层字段**：`version`、`project`、`last_updated`、`current_phase`、`phases`

**允许的任务字段**：`id`、`title`、`story`、`status`、`last_updated`、`documents_required`、`dependencies`、`test_file`、`notes`

**禁止的字段**（必须使用其他机制）：
| 禁止字段 | 替代方案 |
|---|---|
| `documentation_conflicts` | GitHub Issue + `docs/decisions/` ADR |
| `decisions` | `docs/decisions/` ADR（R11） |
| PR review 延期修复条目 | `docs/05-planning/deferred-items.json` |
| 其他元数据/审计字段 | 各自归属的文档系统 |

**级联更新**：Agent 启动或任务完成时，遍历所有 `pending` 任务，若 `dependencies` 全部为 `done`，则翻转为 `ready`。此操作为幂等操作。

### 8.1.5 deferred-items.json 生命周期（R14）

```
R14 PR review 或自行检查中发现的合理但需**延期修复**的问题（🟡 警告/规格偏离/设计权衡），必须在识别后立即写入 deferred-items.json 留档，不得遗漏。
能立即修复的应在当前 PR 中直接修掉，无需留档。commit-pr-itest 在提交前须确认延期项已留档。
```

**来源分类**：延期项可来自两类渠道，**均须同样对待**：

| 来源 | 识别时机 | 示例 |
|---|---|---|
| PR review（CodeRabbit / 人类 reviewer） | `pr-review-itest` 执行时 | reviewer 指出的安全/性能/架构问题 |
| 自行检查 | 实现过程中发现与文档/架构/AI 建议的偏离 | 字段类型与数据流文档不一致、本地类型重复但重构成本高 |

**创建**：`pr-review-itest` 第五步之半（PR review 来源）或 `commit-pr-itest` 第一步 §2（自行检查来源）— 每条必须逐条写入，含完整上下文（`detail` 字段强制必填）。

**追踪**：`next-task-itest` 第一步 — 若当前阶段有 `target_phase` 匹配且 `status: "open"` 的条目，输出提醒。

**提交门禁**：`commit-pr-itest` 第一步 §2 — 若刚完成 review 且有 🟡 警告未留档，阻断 commit。

**出口检查**：Phase 集成测试任务中 — 检查本阶段 `target_phase` 的 open 条目是否已随其他任务顺便修复；若是，更新 `status → resolved` + `resolved_by`；若否，保留 open 并记录检查结果。

**关闭**：条目修复后通过 `sync-docs-itest` 将 `status` 更新为 `resolved`，**不得删除条目**（保留审计轨迹）。

### 8.2 跨阶段阻断规则

阶段 N 的任务**不得**在阶段 N-1 的最后一个任务（验收/集成测试）完成前开始执行。Agent 必须先完成前一阶段验收，推进 `current_phase`，再进入下一阶段。

## 9. Agent 自检清单与禁忌

### 9.1 每次任务执行前

```
[ ] 已读取 docs/INDEX.md 建立全局认知
[ ] 已读取 docs/05-planning/task-status.json 确认任务状态
[ ] 已根据 §0.2 映射表读取对应文档章节
[ ] 已在回复中逐字粘贴相关 AC/规则原文
[ ] 已确认所有依赖任务状态为 done
```

### 9.2 每次提交代码前

```
[ ] bun run typecheck 通过
[ ] bun run lint 通过
[ ] bun test 全部通过
[ ] 已更新 task-status.json
[ ] 无敏感数据提交（R6）
[ ] Commit Message 符合 §3.1.2 格式
```

### 9.3 Agent 禁忌清单

| 行为 | 后果 | 说明 |
|---|---|---|
| 跳过 §0.2 文档映射直接编码 | 实现偏离规格 | 强制溯源，防幻觉 |
| 接受 AI "看起来对"的核心链路为事实 | 结论错误（R4） | 必须候选+证据+用户确认 |
| 静默降级或臆造指标 | 结果不可信（R5） | 不确定必须显式标注 |
| 真机能力"看代码就算过" | 实际不可用（R3） | 必须真机 spike 实测(G5)+Simulator G5-SIM |
| 敏感数据落盘明文 | 安全风险（R6） | 只在内存注入，落盘必脱敏 |
| 未确认就写项目目录 | 污染项目（R7） | 默认写 ~/.itestagent/ |
| 未出计划就进编码 | 方向错误（R8） | 先出计划等人确认 |
| 使用 qa-* 命名 | 规范违反（R9） | 统一 itestagent-* |
| 引入 Effect-TS/事件溯源 | 过度设计（R10） | AI SDK + MCP 即可 |
| 跳过任务状态更新 | 进度丢失 | task-status.json 必须同步 |
| **Agent 自动合并 PR** | 禁止 | 合并必须由人类手动执行，PR 目标分支为 `dev-1.0`（非 `main`） |
| **GitHub 可见内容使用中文** | 禁止（R12） | commit/PR/评论/代码注释必须英文，docs/ 豁免 |

## 10. 在 OpenCode 中的工作约定

```
- 优先读本文件与相关规格章节，再动手；不要凭想象实现
- 一个 User Story = 一个任务：输入 US 描述 + AC + 相关文档章节 + 相关代码/schema
- 大改动先出计划让人确认；小步提交，便于验证
- 真机能力开发用 mock backend + fixtures 先跑通逻辑，再真机 spike 验证
- 需要外部库/新依赖前，先核对技术选型文档，未列入的先讨论
- 涉及危险操作(删除/卸载/写项目/凭证)必须显式征得确认，不擅自执行
- 提交信息遵循仓库风格；无用户明确要求不擅自 commit/push
```

建议的仓库结构（与架构设计文档 §10 对齐，独立 workspace 包）：

```
packages/
  itestagent-cli/                 (CLI 入口, Commander)
  itestagent-tui/                 (TUI Shell, OpenTUI 目标主线 / Ink 已验证 fallback)
  itestagent-engine/              (Agent 编排循环 + 权限引擎)
  itestagent-server/              (本地 Bun server + SSE + session 状态)
  itestagent-store/               (SQLite + Drizzle + 文件系统 artifacts)
  itestagent-project-analyzer/    (XcodeProj + swift-syntax + sourcekit)
  itestagent-contracts/           (Zod schemas + Backend 接口契约)
  itestagent-report/              (报告三件套合成)
  itestagent-flow/                (iTestAgent Flow YAML)
  itestagent-backends/
    device-mobile-mcp/            (DeviceBackend 强候选，需付费账号)
    device-appium/                (DeviceBackend 长期标准 fallback)
    device-iphone-use/            (DeviceBackend 视觉 fallback)
    performance-xctrace-analyzer/ (PerformanceBackend MVP 第一候选)
    performance-instrumentsmcp/    (PerformanceBackend 录制/report 参考，非默认可信)
    build-xcodebuild/             (BuildDriver MVP 默认)
    build-fastlane/               (BuildDriver 签名复杂时启用)
    analyzer-xcodequery/          (ProjectAnalyzerBackend optional future，本机不可用)
    analyzer-xcodeproj/           (ProjectAnalyzerBackend 成熟方案)
schemas/ (project-profile, test-plan, result, artifact-index, flow, config)
fixtures/ (device-responses, mobile-mcp, appium, xctrace, xcresult)
mocks/ (mock backends — 约定：mock 实现放在 packages/itestagent-backends/)
tests/
  integration/                    (跨包集成测试，按 Phase 分目录)
    cross-phase/                  (跨 Phase 联调，Phase N 不破坏 Phase N-1)
    phase1/                       (Phase 1 跨包集成测试)
    phase2/...                    (后续 Phase 集成测试)
docs/01-spec/                  (规格与需求)
docs/02-architecture/          (架构设计与技术选型)
docs/03-implementation/        (避坑手册)
docs/06-verification/          (Spike 验证与 G5/G5-SIM 报告)
docs/04-ai-native/             (AI Native 开发手册)
docs/05-planning/              (开发计划与任务追踪)
docs/decisions/                (ADR 架构决策记录)
AGENTS.md
```

测试文件存放约定：
- 单元测试：各包内 `packages/<pkg>/test/*.test.ts`（测试本包内部逻辑，Bun 自动发现）
- 集成测试：`tests/integration/phase{N}/phase{N}-*.test.ts`（跨包联调，Phase 验收级）
- 跨 Phase 联调：`tests/integration/cross-phase/*.test.ts`（累进验证，Phase N 不破坏 Phase N-1）
- 测试数据：`fixtures/`（跨包共享）
- Mock backends：`packages/itestagent-backends/`（mock 实现）
- 各包 `src/` 目录只放生产代码，`test/` 目录只放测试代码
- task-status.json 中 `test_file` 字段指向具体测试文件路径

## 11. 常用命令（用户侧行为，实现须对齐）

```
itestagent                 # 进入 TUI(核心入口)
itestagent doctor          # 环境诊断与引导
itestagent devices         # 查看本机 iPhone
itestagent config          # 配置管理
itestagent --version
itestagent explain <run>   # 失败解释
itestagent rerun <run> --failed-only
itestagent run flow <id>   # 重放 Flow(调试/自动化辅助)
```

开发期本地校验（示例，按实际脚手架调整）：

```
bun install
bun run typecheck
bun run lint
bun test
bun run build
```

## 12. 任务模板（贴给 Agent 用）

实现任务：

```
角色：iTestAgent 研发 Agent
目标：实现 <US-x.y / 模块>
必读：AGENTS.md + <相关文档章节> + <相关代码/schema>
硬约束：Local-first/TUI-first/真机与 Simulator 同级支持(Target-explicit)；红线 R1-R12；不确定必标注
交付：1) 复述约束与现状 2) 出计划等确认 3) 小步实现+测试 4) 逐条对 AC 自检并附证据
```

评审任务：

```
角色：严格评审 Agent
检查：规格一致/命名 itestagent-*/复用未违红线/测试覆盖 AC/无臆造与静默降级
输出：按严重度的问题清单 + 必改项
```

调试任务：

```
角色：调试 Agent
要求：先给 >=3 假设按证据排序 -> 最小复现验证 -> 根因确认后最小修复+回归 -> 证据不足则 inconclusive
```

## 13. 反模式（禁止）

```
- 一次性生成整模块不分步验证
- 不给文档上下文凭想象实现
- 接受 AI “看起来对”的核心链路/断言/指标为既定事实
- 真机能力不实测就宣称完成
- 静默降级/臆造指标(如假装拿到精确 FPS)
- 账号/token 写进代码/日志/报告/提交
- 改代码不更新文档造成规格漂移
- 自研已复用底座 / 碰私有框架 / 逆向 .trace
- 使用 qa-* 命名
```

## 14. 完成定义（DoD）

一个任务“完成”当且仅当：

```
[ ] 对齐对应 US 的全部 P0 AC(P1 允许限制但需声明)


[ ] G1-G7+G5-SIM 全过；真机能力已真机 spike 实测(G5)；Simulator 能力已 Simulator spike 验证(G5-SIM)


[ ] 产物过 schema；命名 itestagent-*；未违红线


[ ] 不确定/降级/不可导出项已显式标注


[ ] 无敏感数据落盘明文；高风险操作有确认


[ ] 相关文档已同步更新，无规格漂移
```

## 15. 当前上下文

```
iTestAgent 是一个通用工具，不绑定任何特定项目。用户在任何 iOS 项目目录中启动 itestagent 即可针对该项目工作。
当前开发阶段以无既有测试的 iOS 项目作为验证案例，确保 DeviceBackend 探索路径在真机(iPhone)和 Simulator 上双重可行(ADR-011)。
人力       1 名独立开发者(全栈, AI Native 全程)
阶段策略   先做多 Backend 横评(端到端真机 + 元素定位)定路线，再按 Phase 1-5 推进到 MVP
MVP 边界   去风险 MVP：人在环路记录器 + 稳健性能趋势工具；研究级能力后置
```

一句话给 Agent：**先读规格、先理解项目、小步可验证、真机必实测、不确定就标注、危险操作先确认、命名用 itestagent-\*、能复用绝不自研。**