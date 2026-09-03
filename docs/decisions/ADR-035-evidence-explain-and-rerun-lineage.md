# ADR-035：证据驱动解释、重跑血缘与 flaky 判定

**状态**：Accepted

**日期**：2026-09-03

**决策者**：Logan Su + Codex（T6.9 规格评审）

**关联任务**：T6.9

## 背景

US-14.1 要求 `itestagent explain` 基于真实 run 证据归因，US-16.1 要求 `rerun --failed-only` 复用原 TestPlan/数据、实际重放失败用例并关联原 run。现有规格只描述目标，没有锁定以下可测试语义：

- `parentRunId` 仅存在 SQLite 查询索引，没有写入 canonical run bundle；脱离 SQLite 或 reconciliation 后会丢失重跑血缘。
- `explain` 没有明确必须读取 `steps.json`、证据采集结果和计划快照；现有入口把 steps 置空。
- 旧 flaky 规则会把 `explored` 当作通过，并混合不相关 run；这违反“无断言不判 passed”和 R5。
- XCUITest 的配置 target 与 `-only-testing` case identifier 不是同一概念，不能通过覆盖已确认 target 来表达 failed-only。
- “复用数据”没有说明 SecretRef、Keychain 和运行时注入值的边界。

## 方案比较

### 方案 A：血缘只保存在 SQLite，按项目历史统计 flaky

优点：改动小。

缺点：run bundle 不能独立审计；数据库恢复后血缘丢失；不同计划、设备或 case 的结果可能被错误聚合；`explored` 容易被误当作成功。

### 方案 B：覆盖原 TestPlan 的 features/targets 后重跑

优点：执行器可直接读取过滤后的字段。

缺点：破坏原计划快照；无法区分用户确认范围和本次重跑子集；XCUITest target 与 case identifier 混用；审计时无法还原选择原因。

### 方案 C：保留原计划并增加显式 rerun 元数据（决策）

优点：原确认计划与数据策略保持可审计；两条执行路径共享 case 选择契约；血缘可由 bundle 恢复；flaky 可以按亲子 run 的同一 case 确定性判定。

缺点：需要同步 TestPlan、RunResult、报告合成、RunStore reconciliation 和双路径调度。

## 决策

### 1. explain 是只读的完整 bundle 消费者

`itestagent explain <run_id>` 与 `explain latest` 只接受带 `result.json` commit marker 且通过 plan/steps/result/artifact-index 交叉校验的 canonical bundle。`latest` 解析到最新的有效 canonical bundle，不能因时间更新而选择 incomplete/corrupted 目录。显式指定的 incomplete、corrupted、未知版本或只有 legacy limitation 的 bundle 必须拒绝或以 typed limitation 返回，不能补造事实。

解释输入至少包含：

```text
plan.yaml
steps.json
result.json
artifact-index.json（含 collectionOutcomes）
同一 parent/child lineage 中可比较 case 的结果
```

`raw-local-only` 的截图、视频、UI tree、syslog、crashlog 与 xcresult 原文不得进入模型上下文、CLI 日志或外部传输。规则引擎可以使用 artifact type/id/path 元数据、collection outcome、经过脱敏的 RunStep 结构化结果，以及已经标为 `redacted` 或 `safe` 的派生内容。只有模型安全投影可以进入 LLM。

`explain` 不改写已提交 run bundle。若执行收口阶段已经在 `result.json.explanation` 保存归因，命令优先展示并校验该事实；否则按同一证据规则生成只读派生解释。任何缺失证据都必须降低置信度或返回 `inconclusive`。

### 2. 重跑生成新的 TestPlan child run

`itestagent rerun <run_id> --failed-only` 仅消费 canonical `itestagent.test-plan.v3` bundle。FlowReplayPlan 使用已有 `itestagent run flow <flowId>` 入口，不得伪装成 TestPlan 重跑。

child `plan.yaml` 保留原 TestPlan 的 target、device、appSource、backend preference、resolved execution path、测试数据策略、断言、性能、artifact 和 safety 语义，只更换新的 `runId` 并增加：

```text
rerun:
  parentRunId: <直接来源 runId>
  mode: failed_only | all
  selectedCaseIds: [<本次实际选择的稳定 caseId>]
```

`selectedCaseIds` 必须非空、唯一，并且都存在于 parent `result.cases[]`。`failed_only` 只选择 parent 状态为 `failed` 或 `flaky` 的 case；`blocked`、`cancelled`、`explored`、`inconclusive` 与 `needs_assertion` 不属于产品失败，不得被静默纳入。没有可重跑 case 时，在接触设备或创建 child run 前返回稳定错误。

DeviceBackend 路径以 `selectedCaseIds` 限制动态 case 执行；XCUITest 路径先验证 xcresult caseId 可作为 xcodebuild test identifier，再把同一列表作为 `-only-testing` test identifiers，不能覆盖或冒充 `execution.xcuitest.targets` 的配置 target。identifier 无法无歧义映射时必须 blocked，不能扩大为全量测试。两条路径都复用已确认的 `resolvedPath`，重新执行路径专属 readiness，执行开始后不得跨路径 fallback。

命令调用本身表示用户请求执行该已确认计划的 child run，不要求再次确认相同 TestPlan；构建、替换 App、准备 WDA、凭证和其他 R7 高风险动作仍必须在本次执行重新经过 PermissionEngine。

### 3. 数据复用遵循安全边界

“复用原 TestPlan 与数据”表示：

- child plan 复用 parent plan 中已经持久化的非敏感数据策略、Flow 引用和稳定数据引用；
- SecretRef 只复用引用，不复制 secret 值；Keychain 或运行时注入在 child run 中重新解析；
- parent 使用的仅内存数据若已不可用，重跑必须 blocked 并说明缺失项，不能生成替代值后宣称复用；
- 重跑不得把真实账号、OTP、token 或 raw-local-only 证据写入计划、日志或报告。

### 4. parentRunId 是 canonical 血缘事实

RunResult v3 增加可选 `parentRunId`。普通 run 必须省略；带 `plan.rerun` 的 child run 必须存在，等于 `plan.rerun.parentRunId`，且不能等于自身 `runId`。这是向后兼容的可选字段，保持 RunResult v3 与 TestPlan v3；旧 canonical 非重跑 bundle 继续有效。

RunStore 在 begin/commit/reconciliation 时必须从已验证 bundle 恢复同一 `parentRunId`。SQLite 仅是查询索引，不能成为血缘的唯一来源。每次重跑的 parent 是命令直接指定的 run；多次重跑形成可遍历链，不能静默改写为最早祖先。

### 5. flaky 只按同一 lineage 的同一 case 判定

T6.9 的确定性 flaky 规则为：parent case 状态是 `failed` 或 `flaky`，同一 child run 的同一 `caseId` 在可比较执行中状态为 `passed`，则 child case 标为 `flaky`。`explored`、`inconclusive`、`needs_assertion`、`blocked`、`cancelled` 和 `infra_failed` 都不是通过证据。

可比较执行必须满足：child 明确通过 `parentRunId` 指向 parent、计划来自同一确认快照、caseId 相同、targetKind 相同，并且目标设备解析没有违反原计划。无血缘的全局历史、不同 Project Profile、不同 case 或跨 physical/Simulator 的结果不能产生确定性 flaky 状态。

child run 聚合规则：仍有任一 `failed` case 时 run 为 `failed`；否则存在 `flaky` case 时 run 为 `flaky`；其余按本次真实 case 状态聚合。重复失败不标 flaky。证据必须引用 parent/child runId、caseId 和双方状态。

### 6. 失败归因的历史范围

产品回归、flaky 或历史趋势只能使用可比较 case。无 case 级可比证据时允许输出低置信度建议，但 `explanationType` 必须为 `inconclusive`，不得因为同项目其他 run 的状态混合而归因。

## 后果

### 正面

- run bundle 脱离 SQLite 后仍保留重跑血缘和实际选择范围。
- failed-only 在 XCUITest 与 DeviceBackend 路径上拥有同一、可测试的 case 语义。
- flaky 判定不再把探索结果或无关历史当作通过证据。
- explain 遵守 ADR-032 的本地原始证据边界。

### 负面

- TestPlan v3 与 RunResult v3 增加向后兼容的可选字段，所有 canonical writer 和交叉校验必须同步。
- XCUITest 重跑依赖 xcresult caseId 可直接作为 `-only-testing` identifier；无法满足该格式时必须 blocked，不能扩大为全量测试。
- 仅内存测试数据可能无法重跑，必须显式要求用户重新提供。

## 验证要求

- explain 从真实 bundle 读取非空 steps、artifact metadata、collection outcomes 和 plan 上下文；incomplete/corrupted bundle 被拒绝。
- raw-local-only 内容不会进入模型输入或 CLI 正文；证据不足返回 `inconclusive`。
- failed-only 只选择 `failed|flaky` case，空选择在设备访问前失败。
- DeviceBackend 只执行 selectedCaseIds；XCUITest 只把 selectedCaseIds 传给 `-only-testing`，配置 targets 保持不变。
- child plan/result 的 parentRunId 一致、自身不循环，并可由 reconciliation 恢复到 SQLite。
- parent failed + child passed 产生 case/run flaky；failed + failed 保持 failed；explored 不作为 passed；不同 lineage/targetKind/case 不参与判定。
- SecretRef 只复用引用；缺失的仅内存数据导致 blocked。
- 生产 composition 的确定性 transport 测试覆盖两条路径；真实设备或 Simulator 行为只有在对应 G5/G5-SIM 后才能扩大结论。

## 关联文档

- ADR-029：Dual Execution Route Resolution
- ADR-031：Run、Case、Step、Evidence 关联与自包含 Run 目录
- ADR-032：本地原始证据、模型安全投影与语义 UI 风险边界
- ADR-034：Run Bundle 提交协议与证据采集结果
- `docs/01-spec/全量用户故事与验收标准规格书.md`
- `docs/02-architecture/架构设计文档.md`
- `docs/02-architecture/数据流全链路技术说明文档.md`
