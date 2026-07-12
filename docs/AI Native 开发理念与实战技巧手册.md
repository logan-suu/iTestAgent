# iTestAgent AI Native 开发理念与实战技巧手册

## 0. 本手册定位

本手册面向 iTestAgent 团队，指导以 **AI Native** 方式开发本项目。它不是通用 AI 编程科普，而是**结合本项目已有五份文档（项目概述、用户故事与验收标准、架构设计、技术选型、数据流全链路）**，把这些设计如何用 AI Native 方式高效、可靠落地讲清楚。

配套文档（同一文件夹）：

```
iTestAgent项目概述
iTestAgent 全量用户故事与验收标准规格书
iTestAgent 架构设计文档
iTestAgent 技术选型文档
iTestAgent 数据流全链路技术说明文档
```

阅读建议：先读“1 理念”，动手前读“5 工作流”和“6 实战技巧”，评审时读“8 质量门禁”。

## 1. 什么是 AI Native 开发（本项目语境）

AI Native 不是“用 AI 补全几行代码”，而是**把 AI Agent 当作团队的一等生产力，把项目组织成 AI 可理解、可执行、可验证的形态**。

本项目的 AI Native 有双重含义：

```
含义一：iTestAgent 产品本身是 AI Native 产品
  它是一个 TUI Agent：先理解 iOS 项目，再自动测试真机。
含义二：iTestAgent 的研发过程也用 AI Native 方式进行
  用 AI Agent 读文档、写代码、写测试、评审、修 bug、生成文档。
```

两者是自洽的：**我们用 AI Native 的方式，开发一个 AI Native 的产品。** 我们对产品要求的原则（先理解再动手、证据驱动、诚实降级、人在环路、可复现），同样适用于我们自己的研发流程。

## 2. 六条核心理念

```
理念1 规格即上下文（Spec as Context）
  五份文档就是 AI 的“真理来源”。任何 AI 生成都必须以文档为准，冲突时改文档或纠正 AI，不放任漂移。

理念2 先理解，再动手（Understand before Act）
  与产品的 Project Analyzer 一致：AI 写代码前先读相关文档与既有代码，产出计划，人确认后再实现。

理念3 证据驱动（Evidence-driven）
  与产品“结论+原因+证据”一致：AI 的每个结论/改动都要有依据（文档条目、代码位置、运行输出），禁止臆造。

理念4 人在环路（Human-in-the-loop）
  与产品探索式测试一致：AI 负责推断和执行，关键决策（架构、危险操作、入库）由人确认。

理念5 诚实降级（Honest Degradation）
  与产品 explored/inconclusive/not_exportable 一致：AI 不确定就说不确定，不硬凑“看起来对”的答案。

理念6 小步可验证（Small Verifiable Steps）
  每次 AI 改动都对应可运行验证（类型检查/测试/真机 spike），拒绝一次性大爆炸式生成。
```

## 3. 上下文工程（Context Engineering）

AI 输出质量取决于上下文质量。本项目把上下文分层管理。

```
L0 项目宪法      本手册 + 项目概述“产品原则/已确认实现决策”，任何时候优先级最高
L1 领域规格      架构设计 / 技术选型 / 数据流 / 用户故事，按任务取相关章节
L2 代码上下文    相关模块源码、接口定义、schema、既有测试
L3 运行时证据    doctor/devices 输出、xcresult、日志、trace summary、报告
```

给 AI 喂上下文的规则：

```
- 每个任务显式引用 L1 的具体章节（如“依据 数据流 S7 归一化契约”）
- 契约优先：把 result.json / plan.yaml / Project Profile 等 schema 作为强约束贴给 AI
- 不要一次性塞全部五份文档，按任务裁剪，避免上下文噪声
- 让 AI 复述它理解的约束，再开始写（先理解再动手）
```

沉淀为仓库内 AI 上下文（建议）：

```
AGENTS.md / .cursorrules / CLAUDE.md   项目宪法与硬约束（术语、命名、红线）
docs/specs/*                            五份文档的本地镜像或链接
schemas/*.json                          plan/result/artifact-index/project-profile schema
```

## 4. 把项目规格转成 AI 可执行单元

用户故事天然适配 AI Native：每个 US-x.y 已带验收标准，可直接作为 AI 任务单元。

映射规则：

```
1 个 User Story -> 1 个 AI 任务
  输入：US 描述 + AC + 相关 L1 章节 + 相关代码
  产出：实现 + 单测/集成测试（覆盖 AC）+ 自检报告（逐条对 AC）
验收：AC 逐条可验证；P0 全绿才算完成
```

示例：US-5.1 编译 TestPlan

```
上下文：数据流 S3 的 TestPlan 契约 + 架构 6 编排内核 + 技术选型 6/8
任务：实现 NL/命令 -> TestPlan 编译器，输出符合 plan.yaml 契约
测试：给定 Intent+Profile，编译出的 TestPlan 通过 schema 校验；关键字段断言
自检：逐条对 US-5.1 AC1-AC4 打勾并附证据
```

## 5. AI Native 开发工作流（EPCC-V）

推荐统一循环：Explore -> Plan -> Code -> Check -> Verify。

```
Explore  读文档相关章节 + 相关代码，AI 复述约束与现状
Plan     AI 产出实现计划（改哪些文件/接口/schema/测试），人确认
Code     小步实现，一次一个可验证单元
Check    类型检查 + Lint + 单测/集成测试
Verify   对齐 AC；涉及真机能力走真机 spike 实测；证据留档
```

流程图：

铁律：

```
- 未经人确认的计划不进入 Code
- 每个 Code 单元必须能被 Check 验证
- 真机相关（签名/WDA/xctrace/设备）必须 Verify 用真机 spike，禁止“看代码就算过”
```

## 6. 分模块实战技巧

### 6.1 编排循环与权限引擎（自研核心）

```
- 让 AI 照搬架构文档第 6 节循环骨架，用 Vercel AI SDK 多步 tool-calling 实现
- 工具统一 { description, inputSchema(zod), outputSchema, execute }
- 权限引擎 allow/deny/ask + 记忆规则：高风险操作强制 ask
- 用“工具调用可重放的最小 harness”让 AI 自测循环，不必真连设备也能验证 idle/续跑逻辑
技巧：先写 tool 契约与假实现（mock adapter），跑通循环，再接真机
```

### 6.2 iPhone 真机适配层（复用为主）

```
- 明确告诉 AI：WDA/Appium/xcodebuild/devicectl 复用，不自研（技术选型第 9 节）
- 让 AI 把每个真机能力封装成 MCP tool，屏蔽命令细节
- 版本差异（Xcode 26 Deferred、xctrace schema）在 adapter 内吸收
技巧：真机能力先做 mock adapter + 录制的真实输出样本（fixtures），让 AI 针对 fixtures 写解析，最后真机验证
```

### 6.3 Project Analyzer（AI 最容易过度自信处）

```
- 结构识别（XcodeProj/xcodebuild -list）是确定性的，让 AI 严格解析，不许猜
- 业务链路是推断，让 AI 输出 候选+证据+置信度，绝不自动断定
- 与产品理念一致：AI 给建议，用户确认
技巧：给 AI 明确“确定性字段 vs 推断字段”清单，推断字段必须带 evidence 与 confidence
```

### 6.4 性能与 .trace 解析（诚实降级重灾区）

```
- 主指标 hitches/hangs/launch/memory/crash/duration；FPS 标 approximate
- xctrace 解析用 export --toc 探测 + --xpath 抽取；不可导出标 not_exportable
- 让 AI 参考 XcodeTraceMCP/instruments-analyzer 的 schema 处理，不整包依赖
技巧：给 AI 真实 .trace 导出 XML 样本做 fixture；要求对未知 schema 走容错分支而非崩溃
```

### 6.5 数据契约与报告

```
- 把 数据流文档 的 result.json/artifact-index.json/plan.yaml/project-profile.json 契约作为强约束
- 所有产物写 schemaVersion；AI 生成必须过 schema 校验
技巧：先定 schema（zod + JSON schema），让 AI 面向 schema 编码与测试
```

## 7. Prompt / 任务模板

### 7.1 通用实现任务模板

```
角色：iTestAgent 研发 Agent
目标：实现 <US-x.y / 模块>
必读上下文：
  - 本手册第 1/2 节（理念）
  - <相关文档章节，如 数据流 S7 / 架构 6>
  - <相关代码/接口/schema>
硬约束：
  - Local-first、TUI-first、只面向 iPhone 真机
  - 复用清单里的库不自研；红线不碰私有框架/二进制逆向
  - 不确定要显式标注（诚实降级）
交付：
  1) 先复述你理解的约束与现状（不写码）
  2) 给实现计划（改动文件/接口/schema/测试），等我确认
  3) 确认后小步实现 + 测试
  4) 逐条对 AC 自检并附证据
```

### 7.2 评审任务模板

```
角色：严格的代码/设计评审 Agent
输入：本次改动 + 对应 US 的 AC + 相关文档章节
检查：
  - 是否符合文档约束与命名（itestagent-*，不用 qa-*）
  - 是否复用既定库、未违反红线
  - 是否有对应测试、AC 是否逐条满足
  - 是否有臆造/静默降级/未标注的不确定
输出：问题清单（按严重度）+ 必改项 + 建议项
```

### 7.3 调试任务模板

```
角色：调试 Agent（对齐产品失败归因理念）
输入：失败现象 + 证据（日志/xcresult/截图/trace summary）
要求：
  - 先给 3 个假设，按证据排序
  - 用最小复现验证假设，不要盲改
  - 根因确认后最小修复 + 回归测试
  - 若证据不足，明确 inconclusive，不硬下结论
```

## 8. 质量门禁（AI 产出验收）

任何 AI 产出并入主线前必须过：

```
G1 规格一致  与五份文档不冲突；冲突需先改文档或纠正实现
G2 契约校验  产物过 schema（plan/result/artifact-index/project-profile）
G3 静态检查  类型检查 + Lint 通过
G4 测试通过  单测/集成测试覆盖对应 AC；P0 全绿
G5 真机验证  涉及真机能力必须真机 spike 实测（不接受“看代码就过”）
G6 证据留档  自检报告逐条对 AC；不确定项显式标注
G7 安全合规  无敏感数据落盘明文；高风险操作有确认
```

判定：

```
G1-G4/G6/G7 未过 -> 不合并
G5 对真机相关能力是硬门槛；纯逻辑单元可用 mock+fixtures 验证但需说明
```

## 9. 反模式（禁止）

```
- 让 AI 一次性生成整个模块而不分步验证
- 不给文档上下文，凭 AI 想象实现（导致偏离规格）
- 接受 AI “看起来对”的核心链路推断当作既定事实
- 真机能力不实测，仅凭代码通过就宣称完成
- AI 静默降级/臆造指标（如假装拿到精确 FPS）
- 把账号/token 直接写进代码、日志、报告或提交
- 用 AI 改动却不更新对应文档，造成规格漂移
- 自研已复用的底层（WDA/xcodebuild/xctrace 解析私有格式）
```

## 10. 度量与持续改进

```
过程度量  AI 任务一次通过率、返工率、AC 覆盖率、真机 spike 通过率
质量度量  缺陷逃逸率、规格漂移次数、静默降级发现数
效率度量  单个 US 平均交付时长、评审轮次
改进机制  每迭代回顾 AI 反模式命中项，沉淀进本手册与 AGENTS.md
```

## 11. 落地清单（Checklist）

启动开发前：

```
[ ] 仓库内建立 AGENTS.md/CLAUDE.md（项目宪法 + 红线 + 命名）


[ ] 建立 schemas/（plan/result/artifact-index/project-profile）


[ ] 建立 fixtures/（真实 xcresult/.trace 导出样本、UItree 样本）


[ ] 建立 mock adapters（无真机也能跑循环/解析）


[ ] 约定 EPCC-V 工作流与质量门禁 G1-G7
```

每个 User Story：

```
[ ] 裁剪相关文档上下文 + 契约


[ ] AI 复述约束 -> 出计划 -> 人确认


[ ] 小步实现 + 测试覆盖 AC


[ ] 真机能力做 spike 实测


[ ] 逐条对 AC 自检并留证据


[ ] 如有变更同步更新文档，避免漂移
```

## 12. 与产品理念的一致性对照

```
产品：先理解项目再测试     研发：先读规格再动手
产品：候选+证据+用户确认   研发：AI 出计划+证据+人确认
产品：explored/inconclusive 研发：AI 诚实降级，不臆造
产品：高风险操作需确认     研发：架构/危险改动/入库需人确认
产品：run 可复现可审计     研发：改动小步可验证、证据留档
产品：复用成熟不自研底层   研发：AI 不重造已复用能力
```

一句话：**我们对 iTestAgent 提出的一切原则，先用在我们自己开发 iTestAgent 的过程里。**