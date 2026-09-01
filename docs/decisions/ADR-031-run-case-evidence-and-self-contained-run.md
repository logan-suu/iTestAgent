# ADR-031：Run、Case、Step、Evidence 关联与自包含 Run 目录

**状态**：Accepted

**日期**：2026-09-01

**决策者**：Logan Su + Codex（T6.6/T6.8 规格评审确认）

**关联任务**：T6.6、T6.8

## 背景

Phase 6 规格评审发现，现有文档要求“证据关联到具体 run step / case”，但 `RunStep` 没有 case 归属，`ArtifactRef` 只有可选 `relatedStep`，无法表达逐 case checkpoint。现有探索实现因此可能在全部动作结束后读取同一个最终 UI tree，并把它标记为多个 case 的证据（DEF-030）。

同时，数据流文档宣称每个 run 目录可以独立复现和审计，但 Run Steps 只存 SQLite，run 目录中的 `result.json` 仅保留 step ID。复制单个 run 目录后无法恢复实际动作、输入、输出、顺序和证据关联。

报告示例与发布 Schema 还存在字段漂移：`infra_failed` 无法写入 `result.json`，执行方式不是必填，metrics、failure explanation 与 syslog artifact 的字段名不一致。

## 方案比较

### 方案 A：维持 SQLite 为唯一 Run Step 存储

优点：无需新增文件。

缺点：run 目录不能独立审计；报告中的 step ID 离开全局数据库后失去含义；无法满足 US-19.1。

### 方案 B：把完整 Run Steps 嵌入 `result.json`

优点：机读结果只有一个入口。

缺点：扩大报告主契约；长时间录制会使 `result.json` 过大；步骤追加与最终报告合成耦合。

### 方案 C：增加 `steps.json` 审计侧车文件（决策）

优点：run 目录自包含；步骤可流式/增量写入后原子收口；报告三件套保持稳定；SQLite 仍可做查询索引。

缺点：需要新增持久化 Schema、迁移和交叉引用校验。

## 决策

### 1. 探索分为自动探索与交互录制

- 自动探索：用户确认 TestPlan 后，Agent 可以执行计划范围内的低风险动作序列；R7 高风险动作仍逐项经过 PermissionEngine。
- 交互录制：Agent 每步提出动作和依据，用户确认、修改或跳过；只有实际确认并执行的步骤可以编译进 Flow。
- 两种模式都必须记录 Run Steps。Run Steps 是事实日志，不等同于 Flow。
- Flow 是从已确认步骤编译出的派生产物；保存、覆盖或写入项目目录必须经过用户确认。未确认建议、跳过步骤和失败定位不得变成可重放动作。
- 权限动作使用 `save_flow` 表示首次保存、`overwrite_flow` 表示覆盖已有 Flow、`write_project_file` 表示写入项目目录；需要组合确认时不得合并或省略其中任一项。
- 自动探索以已确认 `TestPlan.execution.features[]` 为 case 边界：每个 feature 形成稳定 `caseId`，Agent 在该 case 内逐步建议低风险动作，返回 `done` 或达到已确认步数上限时结束。每个参与 case 判定的动作执行并 settle 后必须立刻采集 checkpoint；不得以后续 case 或整轮结束时的页面替代。

### 2. Run Step 必须表达顺序、目标域和 case 归属

后续 canonical RunStep Schema 必须至少包含：

```text
stepId
sequence
backend
targetKind
caseId?          # run 级 setup/teardown 可缺省；case 动作必须存在
action
target?
input
result/status
artifacts[]
safetyGate?
startedAt
durationMs
```

同一 run 内 `stepId` 与 `sequence` 必须唯一。任何参与 case 断言或 case 结果计算的步骤必须带 `caseId`；启动、全局录屏、环境采集和 teardown 等 run 级步骤可以不带。

每个 case 的 checkpoint 必须在该 case 动作完成后立即采集，不能在整轮动作结束后用最终页面补采并冒充早期状态。checkpoint 至少记录 UI tree；按 ArtifactPolicy 与 backend 能力补充 screenshot、video 或日志。

### 3. Evidence 关联与采集是路径感知的

Artifact 必须可以关联 `relatedStep`、`relatedCase` 或保留为明确的 run-level artifact。参与断言的证据必须同时可追溯到 case；step 产生的证据必须可追溯到 step。

证据集合按已确认 ArtifactPolicy、执行路径、失败类型和 backend 能力采集：

- XCUITest 路径可以产生 `xcresult`；DeviceBackend 路径不得伪造该产物。
- 只有发生 crash 或发现 crash report 时才有 `crashlog`。
- `.trace` 只在已确认性能采集时产生。
- 不支持、未请求、采集失败或不可导出的证据必须记录结构化原因，不得用空文件或错误标签伪造成功。

Artifact 类型保留通用 `log`，并增加明确的 `syslog` 类型；旧 `log` 不做猜测性迁移。

### 4. Run 目录自包含，报告三件套不变

canonical run 目录为：

```text
~/.itestagent/runs/<run_id>/
  plan.yaml
  steps.json
  summary.md
  result.json
  artifact-index.json
  artifacts/
```

`summary.md`、`result.json`、`artifact-index.json` 仍称“报告三件套”。`plan.yaml` 与 `steps.json` 是审计/复现输入，不计入报告三件套。

SQLite 保存 Run/Step/Case/Artifact 的查询索引；`steps.json` 保存 canonical Run Steps。两者必须由同一个 RunStore/RunWriter 写入并通过 `runId` 绑定，不能由互不关联的临时 writer 生成。

### 5. Result 与交叉引用语义

- `result.execution.mode`、`targetKind`、`backendUsed` 与 device identity 必须落盘；`mode` 不再是可选语义。
- persisted run status 必须能表达 `cancelled` 与 `infra_failed`，不能把环境/构建失败伪装成产品测试失败。
- `result.cases[].steps[]` 必须解析到 `steps.json` 中相同 `caseId` 的 step。
- `result.cases[].artifacts[]` 与 `result.artifactRefs[]` 必须解析到同 run 的 `artifact-index.json`。
- `artifact-index.json` 中的 `relatedStep`、`relatedCase` 必须解析到同 run 的 canonical step/case；run-level artifact 可以两者均无。
- metrics 与 failure explanation 的字段名以 runtime canonical contract 为基线统一，文档示例不得维护第二套命名。

### 6. Schema 演进

本 ADR 只批准文档语义，不授权在文档同步步骤中直接修改 runtime/schema。T6.6/T6.8 实现计划必须按 ADR-022 提供纯函数 migration、typed issue、canonical writer 与交叉引用校验。

涉及 persisted RunStep/RunResult/ArtifactIndex 的不兼容新增字段时必须升级 schemaVersion；旧数据无法无损推出 `caseId` 时保留为 run-level 或返回显式 migration limitation，不得猜测。

## 后果

### 正面

- DEF-030 从“实现补丁”提升为可测试的领域契约。
- 单个 run 目录可以脱离全局 SQLite 独立审计。
- 自动探索、交互录制、Run Steps 与 Flow 的边界清晰。
- 路径不适用的证据不再被强制或伪造。

### 负面

- T6.6/T6.8 需要新增持久化 Schema、migration 和跨文件验证。
- RunStore 必须处理 steps 增量写入、异常终止和最终原子收口。
- 旧 run 的 case 归属可能只能标记为未知，不能自动补全。

## 验证要求

- 自动探索和交互录制分别覆盖；高风险动作仍经过 PermissionEngine。
- 每个 case 动作后立即捕获 checkpoint，测试必须证明不同 case 不共享事后补采的最终 UI tree。
- 无断言不得判 passed；未确认的 Agent assertion 不参与 pass/fail。
- run 目录脱离全局 SQLite 后仍能校验 plan、steps、cases、artifact 引用和报告三件套。
- XCUITest、DeviceBackend、crash/non-crash、performance on/off 的证据矩阵均覆盖“不适用/未请求/失败”的显式语义。
- persisted schema 变更遵循 ADR-022；G5/G5-SIM 只对真实验证过的路径作结论。

## 关联文档

- ADR-011：iOS Simulator First-class Support
- ADR-022：Persisted Schema Migrations
- ADR-029：Dual Execution Route Resolution
- ADR-030：Metadata-only XCUITest Candidates
- `docs/01-spec/全量用户故事与验收标准规格书.md`
- `docs/02-architecture/架构设计文档.md`
- `docs/02-architecture/数据流全链路技术说明文档.md`
- `docs/05-planning/task-status.json`
- `docs/05-planning/deferred-items.json`（DEF-030 已由 T6.6 实现及 G5/G5-SIM 验证关闭）
