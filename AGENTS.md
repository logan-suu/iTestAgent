# AGENTS.md

本文件是 iTestAgent 项目的“Agent 宪法”，供 OpenCode 等 AI 编码 Agent 在本仓库工作时**首先阅读并严格遵守**。冲突时以本文件与《iTestAgent项目概述》为最高优先级。落地到代码仓库时，建议将本文件命名为 `AGENTS.md` 放在仓库根目录。

## 0. 一句话项目定位

iTestAgent 是一个**类似 OpenCode 的本地 TUI Agent**，但领域是 **iPhone 真机全自动化测试**：先理解 iOS 项目，再生成测试计划，驱动本机真机执行、采集证据、分析失败并输出本地报告。

```
Local-first, TUI-first, Agent-native, Project-aware, Real-device only.
本地优先、TUI 优先、Agent 原生、先理解项目、只面向 iPhone 真机。
```

## 1. 规格来源（Single Source of Truth）

本仓库的“真理”来自 iOS自动化测试 文件夹下 8 份文档；实现与文档冲突时，先改文档或纠正实现，禁止放任漂移。

```
项目概述           产品定位、原则、已确认实现决策
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
R3 真机能力不得“看代码就算过”，必须真机 spike 实测(G5)
R4 不把“从代码推断的核心链路”当既定事实，只能候选+证据+用户确认
R5 不静默降级/臆造指标(尤其 FPS、xctrace summary)，不确定必须显式标注
R6 敏感数据(账号/OTP/token)不落盘明文、不入日志/报告/提交
R7 高风险操作必须二次确认(清数据/卸载重装/写项目/存凭证/更新 baseline/覆盖 Flow/生成草稿)
R8 未经人确认的实现计划不得进入编码
R9 组件命名统一 itestagent-*，禁止使用 qa-*
R10 不引入 Effect-TS / SQLite 事件溯源等重型编排；不 fork/不 import OpenCode 私有核心
```

## 3. 技术栈（固定，不得随意替换）

```
语言/运行时   TypeScript + Bun
CLI          yargs / commander（轻量入口）
TUI          OpenTUI + Solid（第一版直接做，核心界面）
本地服务      Bun local server + 事件流(SSE)
编排          自建 Agent 循环 + Vercel AI SDK 多步 tool-calling
工具协议      MCP TypeScript SDK（真机能力封装为 MCP tools）
LLM          OpenAI-compatible provider（可扩展）
存储          SQLite + Drizzle（metadata）+ 文件系统（artifacts）
配置          JSONC（jsonc-parser）
真机执行      xcodebuild / xcrun devicectl / xcrun xctrace / xcresulttool / Appium / XCUITest Driver / WebDriverAgent
辅助          fastlane(签名/构建) / xcbeautify(日志) / pymobiledevice3(可选,子进程)
```

复用与自研边界：

```
直接采用   OpenTUI / AI SDK / MCP SDK / Drizzle / Appium / xcuitest-driver / WDA / XcodeProj / swift-syntax / sourcekit-lsp / SourceKitten / xcresultparser / xcparse / xcbeautify / fastlane
借鉴不依赖 XcodeBuildMCP / instruments-mcp-server / XcodeTraceMCP / instruments-analyzer / Periphery / Maestro flow 语义
必须自研   Project Profile 语义、候选链路、TestPlan 编译、编排循环+权限引擎、Flow、失败归因、baseline 策略、TUI 交互体验
```

## 4. 架构与命名

分层（上层依赖下层，禁止反向）：

```
交互层  itestagent-cli / itestagent-tui
编排层  itestagent-server / itestagent-engine / itestagent-project-analyzer
适配层  itestagent-adapters（MCP tools：xcode/device/appium/performance/parser/report/flow）
工具层  Xcode / Appium / WDA / xctrace / devicectl / iPhone 真机
存储层  itestagent-store（SQLite + 文件系统 + 报告）
```

命名约定：

```
- 组件一律 itestagent-*，禁止 qa-*
- core 不作为组件名；核心引擎叫 itestagent-engine
- engine 不直接拼底层命令，一律经 adapters(MCP tools)
- adapters 之间不互调，由 engine/runner 编排
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
执行路径   有 XCUITest -> xcodebuild test；无测试() -> Appium/WDA Agent Flow
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
- 真机相关必须 Verify 用真机 spike(R3)，纯逻辑可用 mock+fixtures 但需说明
- 有代码变更必须同步更新相关文档，避免规格漂移
```

## 8. 质量门禁 G1-G7（并入主线前必过）

```
G1 规格一致  与 8 份文档不冲突
G2 契约校验  产物过 schema(plan/result/artifact-index/project-profile)
G3 静态检查  类型检查 + Lint 通过
G4 测试通过  覆盖对应 AC；P0 全绿
G5 真机验证  涉及真机能力必须真机 spike 实测
G6 证据留档  自检报告逐条对 AC；不确定项显式标注
G7 安全合规  无敏感数据落盘明文；高风险操作有确认
```

## 9. 在 OpenCode 中的工作约定

```
- 优先读本文件与相关规格章节，再动手；不要凭想象实现
- 一个 User Story = 一个任务：输入 US 描述 + AC + 相关文档章节 + 相关代码/schema
- 大改动先出计划让人确认；小步提交，便于验证
- 真机能力开发用 mock adapter + fixtures 先跑通逻辑，再真机 spike 验证
- 需要外部库/新依赖前，先核对技术选型文档，未列入的先讨论
- 涉及危险操作(删除/卸载/写项目/凭证)必须显式征得确认，不擅自执行
- 提交信息遵循仓库风格；无用户明确要求不擅自 commit/push
```

建议的仓库结构（供脚手架参考）：

```
packages/
  itestagent/ (cli, tui, server, engine, project-analyzer, store)
  adapters/ (xcode, device, appium, performance, parser, report, flow)
schemas/ (plan, result, artifact-index, project-profile)
fixtures/ (xcresult/.trace 导出样本, UItree 样本)
mocks/ (mock adapters)
docs/specs/ (8 份规格文档镜像或链接)
AGENTS.md
```

## 10. 常用命令（用户侧行为，实现须对齐）

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

## 11. 任务模板（贴给 Agent 用）

实现任务：

```
角色：iTestAgent 研发 Agent
目标：实现 <US-x.y / 模块>
必读：AGENTS.md + <相关文档章节> + <相关代码/schema>
硬约束：Local-first/TUI-first/只面向 iPhone 真机；红线 R1-R10；不确定必标注
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

## 12. 反模式（禁止）

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

## 13. 完成定义（DoD）

一个任务“完成”当且仅当：

```
[ ] 对齐对应 US 的全部 P0 AC(P1 允许限制但需声明)


[ ] G1-G7 全过；真机能力已真机 spike 实测


[ ] 产物过 schema；命名 itestagent-*；未违红线


[ ] 不确定/降级/不可导出项已显式标注


[ ] 无敏感数据落盘明文；高风险操作有确认


[ ] 相关文档已同步更新，无规格漂移
```

## 14. 当前上下文

```
目标项目   .xcworkspace（无既有测试，需自动构建签名，走 Appium/WDA 探索路径）
人力       1 名独立开发者(全栈, AI Native 全程)
阶段策略   先做双 Spike(端到端真机 + 元素定位)定路线，再按 Phase 1-5 推进到 MVP
MVP 边界   去风险 MVP：人在环路记录器 + 稳健性能趋势工具；研究级能力后置
```

一句话给 Agent：**先读规格、先理解项目、小步可验证、真机必实测、不确定就标注、危险操作先确认、命名用 itestagent-\*、能复用绝不自研。**