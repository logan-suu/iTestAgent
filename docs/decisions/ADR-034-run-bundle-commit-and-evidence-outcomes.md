# ADR-034：Run Bundle 提交协议与证据采集结果

**状态**：Accepted

**日期**：2026-09-02

**决策者**：Logan Su + Codex（T6.8 规格评审确认）

**关联任务**：T6.8

## 背景

T6.8 需要把 `plan.yaml`、canonical `steps.json`、报告三件套和 artifacts 统一写入同一个 run 目录。现有规格已要求同一个 `RunStore/RunWriter` 维护 SQLite 查询索引与文件系统产物，但仍有四个不可直接实现或不可验证的缺口：

1. US-13.1 要求记录证据“不适用、未请求、不支持或采集失败”的原因，而 `ArtifactIndex` 只能表达成功产生的文件。
2. `RunStatus` 同时被 run 与 case 使用，无法在不污染 case 语义的情况下表达 run-level `cancelled` 和 `infra_failed`。
3. `steps.json` 没有文件级根契约，无法绑定 `runId` 或执行跨文件校验。
4. SQLite 与文件系统之间不存在分布式原子提交；若只写“统一落盘”而不定义 commit marker，崩溃后无法区分完整与残缺 run。

同时，“自包含即可复现”的表述过强：Project Profile、项目源码、App 制品和 SecretRef 可能位于 run 目录之外。run 目录能保证的是独立审计与交叉引用校验，不是脱离所有外部依赖后的必然重放。

## 方案比较

### 方案 A：维持现有三个独立 writer

优点：改动最小。

缺点：无法保证同一 `runId`、无法表达证据缺失原因、会继续产生孤立 artifact index，也无法判断目录是否完整。

### 方案 B：尝试让 SQLite 与文件系统形成单一原子事务

优点：概念上最强。

缺点：SQLite transaction 不能原子提交文件系统 rename；实现只能制造虚假的原子性承诺。

### 方案 C：单 run writer + 文件原子替换 + `result.json` commit marker（决策）

优点：符合本地文件系统能力；单文件不会被读到半写状态；完整与 incomplete run 可确定区分；可在启动时幂等协调 SQLite 与目录状态。

缺点：受控终态前会存在 incomplete 目录；需要恢复和兼容读取语义。

## 决策

### 1. 单一所有权边界

- `RunStore.beginRun(...)`（名称可在实现计划中细化）为一个 `runId` 创建唯一的 per-run `RunWriter`。
- 同一 writer 负责该 run 的 SQLite Run/Step/Case/Artifact 查询索引、`plan.yaml`、`steps.json`、报告三件套与 `artifacts/`。
- backend 可以产生事实和 staging evidence，但不能自行发布最终 `artifact-index.json` 或另建报告根目录。
- 同一 run 禁止多个 writer 并发提交。

### 2. `steps.json` 根契约

canonical 文件结构为：

```json
{
  "schemaVersion": "itestagent.run-steps.v1",
  "runId": "run_20260710_001",
  "steps": []
}
```

其中 `steps[]` 使用 ADR-031 的 canonical RunStep。文件级校验必须保证：

- `stepId` 唯一；
- `sequence` 从 1 连续严格递增；
- 参与 case 判定的 step 必须有 `caseId`；
- step 的 artifact ID 必须解析到同 run 的 `artifact-index.json`；
- secret 只能以 SecretRef 或脱敏占位符出现。

XCUITest 路径只记录有权威运行时证据的事实步骤。MVP 至少记录 run-level `xcodebuild_test` 与 `xcresult_parse`；从 xcresult 归一化出的 case 在没有可靠的逐 case 事件/时间证据时允许 `steps: []`。只有取得真实 case 级事件、时间和关联证据时才创建带 `caseId` 的 RunStep；禁止用 suite 时间、解析时间或推断顺序合成 case RunStep 与时间戳。

### 3. `plan.yaml` 是按入口判别的计划快照

`plan.yaml` 使用 `schemaVersion` 判别以下两种 canonical 根契约：

- 常规 Project-aware 执行写入 `itestagent.test-plan.v3`，保留已确认 TestPlan、ProjectProfile 引用与 resolved execution path。
- 独立 `run flow` 写入 `itestagent.flow-replay-plan.v1`，至少固化 `runId`、Flow identity/source/source digest、显式 target/device identity、选定 backend 与选择/readiness 事实、ArtifactPolicy。它由已验证 Flow 与本次显式调用确定性生成，不得伪造 ProjectProfile、候选链路或 TestPlan 确认事实。

两类计划都必须与 bundle 的 `runId` 一致。消费者必须按 `schemaVersion` 分支解析，不得把 FlowReplayPlan 冒充或迁移为 TestPlan。

RunResult v3 的 `projectProfileRef` 为条件字段：与 `itestagent.test-plan.v3` 配对时必须存在并等于计划中的引用；与 `itestagent.flow-replay-plan.v1` 配对时必须省略。单文档结构解析允许该字段缺省，完整性由 bundle 跨文件校验收紧，禁止为独立 Flow 重放填写虚假 Profile 引用。

### 4. Run status 与 Case status 分离

- persisted run status 为：`passed | failed | explored | inconclusive | needs_assertion | flaky | blocked | cancelled | infra_failed`。
- persisted case status 为：`passed | failed | explored | inconclusive | needs_assertion | flaky | blocked | cancelled`。
- `failed` 只表示产品断言或测试结果失败；环境、构建、backend、解析或持久化基础设施失败使用 run-level `infra_failed`。
- run 被取消时，尚未完成的当前 case 可以标为 `cancelled`；未开始的 case 不得伪造成失败。

### 5. 证据采集结果是 artifact index 的一等事实

`artifact-index.json` 除成功的 `artifacts[]` 外，增加 `collectionOutcomes[]`。每个由已确认 ArtifactPolicy、执行路径、失败类型和 backend 能力实际评估的证据槽位都记录：

```text
type
status: collected | not_requested | not_applicable | unsupported | failed
reasonCode
message?
artifactId?
relatedStep?
relatedCase?
```

- `collected` 必须带 `artifactId`，并解析到同 index 的 artifact。
- 非 `collected` 不得带 `artifactId`，且必须带稳定的 `reasonCode`。
- 不要求为系统支持的所有 artifact 类型无边界枚举；只记录本次策略和路径实际评估的证据槽位。
- 失败、空文件、空 bundle、symlink 或 run 外路径不得伪造成成功 artifact。`xcresult` 与 `trace` 可以是类型匹配的非空目录 bundle；其他 artifact 必须是普通非空文件。

### 6. Run bundle 提交协议

canonical run 目录保持：

```text
~/.itestagent/runs/<run_id>/
  plan.yaml
  steps.json
  summary.md
  result.json
  artifact-index.json
  artifacts/
```

写入顺序与可见性规则：

1. 创建权限至少为 `0700` 的 run 根目录和 `artifacts/`。
2. 先校验并原子写入 `plan.yaml`。
3. 每个 checkpoint 后，以同目录临时文件 + rename 原子替换 `steps.json`，并同步 SQLite 查询索引。
4. artifact 文件以至少 `0600` 写入当前 run 的 `artifacts/`；成功引用只能使用相对 run 根目录的 `artifacts/...` 路径。
5. 终态时先校验并原子写入最终 `steps.json`、`artifact-index.json` 和 `summary.md`。
6. 最后原子写入 `result.json`；它是完整 run bundle 的 commit marker。
7. 只有报告三件套、plan、steps 和交叉引用全部校验通过后，SQLite 才把该 run 发布为对应终态。

缺少 `result.json` 的目录是 `incomplete`，不得被 `explain`、`rerun` 或趋势分析当成完整 run。受控的 `cancelled`、`infra_failed` 仍必须生成可校验的报告三件套。进程或主机意外终止留下的 incomplete run 在下次启动时通过 `runId` 幂等协调；不得伪造原执行结果。

SQLite 与文件系统不宣称跨介质原子性。若 `result.json` 已提交而 SQLite 尚未更新，reconciliation 以通过完整 bundle 校验的文件事实恢复查询索引；若 bundle 不完整，则保持 incomplete/infra failure 诊断状态。

### 7. 独立审计与路径安全

- “run 目录自包含”限定为：脱离全局 SQLite 后，plan、steps、cases、artifacts 和报告之间的引用仍可验证。
- 不保证缺少项目源码、Profile、App 制品或运行时 SecretRef 时仍可重放。
- artifact 路径必须相对 run 根目录、位于 `artifacts/` 下，拒绝绝对路径、`..` 穿越、symlink、空文件和空 bundle。
- `xcresult` 与 `trace` 可以引用类型匹配的非空目录 bundle；其他 artifact 只能引用普通非空文件。bundle 必须递归留在当前 run 内，不得包含 symlink 或路径逃逸，并以确定性的相对路径排序 tree hash 与总字节数记录完整性。
- raw-local-only 内容遵循 ADR-032，不得嵌入 summary/result 或进入模型与外部传输。

### 8. Schema 与 migration

- TestPlan canonical writer 保持 `itestagent.test-plan.v3`。
- FlowReplayPlan canonical writer 从 `itestagent.flow-replay-plan.v1` 开始；它是独立计划类型，不迁移成 TestPlan。
- RunResult canonical writer 升级到 v3，使 `execution.mode` 必填并加入 run-level `cancelled`、`infra_failed`。
- ArtifactIndex canonical writer 升级到 v2，加入 `collectionOutcomes[]`。
- RunSteps 从 `itestagent.run-steps.v1` 开始；历史 run 没有 `steps.json` 时不得从 result 的 step ID 猜测步骤内容。
- 所有读取迁移遵循 ADR-022：纯函数、read-only、不原地改写。
- 旧 result 缺失 `execution.mode`、旧 artifact index 缺失采集结果、或旧 run 缺少 canonical steps 时，兼容 reader 返回 `ParsedLegacy` 与明确 limitation，或返回 typed `MigrationIssue`；不得补造事实后标为 canonical。

## 后果

### 正面

- US-13.1 的证据失败原因可被机器读取和测试。
- 产品失败与基础设施失败不会混为一谈。
- 单个 run 目录有明确的完整性判定和恢复边界。
- SQLite 查询索引与文件事实可以幂等协调，而不声称不存在的分布式事务。

### 负面

- T6.8 需要新增 RunSteps、RunResult v3、ArtifactIndex v2、兼容 reader 和多文件校验。
- 每个 checkpoint 原子重写 `steps.json` 会增加本地 I/O；MVP 优先保证审计正确性，性能优化必须保持相同提交语义。
- legacy run 可能只能以带 limitation 的只读模式消费。

## 验证要求

- 测试覆盖正常、failed、cancelled、infra_failed 与中途写入失败。
- 测试证明 `result.json` 缺失时 run 不会被完整消费者接受。
- 测试覆盖 SQLite 提交前后中断与幂等 reconciliation。
- 测试覆盖 plan/steps/result/index 的 runId、case、step、artifact 双向引用。
- 测试覆盖 TestPlan v3 与 FlowReplayPlan v1 两种 plan 根；Flow replay 不得伪造 ProjectProfile/TestPlan 字段。
- 测试覆盖 `projectProfileRef` 条件约束：TestPlan bundle 必填且匹配，FlowReplayPlan bundle 必须省略。
- 测试覆盖 XCUITest run-level build/parse steps；无可靠 case 级事件时 case `steps` 为空且不合成时间线，有非空 case step 引用时必须解析到同 `caseId` 的真实 RunStep。
- 测试覆盖证据 `collected/not_requested/not_applicable/unsupported/failed`，且非成功状态不会生成 ArtifactRef。
- 测试覆盖绝对路径、路径穿越、symlink、普通类型目录、空文件、空 bundle、合法 xcresult/trace bundle、tree hash 与错误权限。
- 测试证明 raw-local-only 内容未嵌入报告或模型输入。
- 本任务可用生产 composition + 确定性 transport/fixture 验证持久化；只有真实设备或 Simulator 路径复验后才能扩大 G5/G5-SIM 结论。

## 关联文档

- ADR-022：Persisted Schema Migrations
- ADR-031：Run、Case、Step、Evidence 关联与自包含 Run 目录
- ADR-032：本地原始证据、模型安全投影与语义 UI 风险边界
- `docs/01-spec/全量用户故事与验收标准规格书.md`
- `docs/02-architecture/架构设计文档.md`
- `docs/02-architecture/数据流全链路技术说明文档.md`
- `docs/05-planning/task-status.json`
