# ADR-030：XCUITest 元数据候选与构建权限边界

**状态**：Accepted

**日期**：2026-09-01

**决策者**：Logan Su + Codex（T6.5 PR 评审修订确认）

**关联任务**：T6.5

**修订**：ADR-029 中“确认前通过 `xcodebuild test -enumerate-tests` 证明可运行”的部分

## 背景

ADR-029 要求在 TestPlan 确认前证明 XCUITest 配置可运行，同时要求该阶段不得安装 App/test runner。T6.5 的首版实现因此使用 generic destination、`CODE_SIGNING_ALLOWED=NO` 与 `xcodebuild test -enumerate-tests`。

该约束仍不安全：`test` action 即使不选择具体设备，也可能执行工程定义的 Run Script build phase 或 scheme pre-action。关闭签名只能限制签名与设备安装，不能把 Test action 变成纯元数据读取。对于任意用户 workspace，确认前执行工程脚本违反最小副作用原则，也不能仅凭一次枚举成功就保证具体 destination、签名和安装最终可用。

同时，首版执行资产把 analyzer 异常折叠成空配置，使 `prefer=auto` 无法区分“权威确认不存在候选”和“探测失败”，可能错误切换到 DeviceBackend。TestPlan 安全策略使用的 action 名称也与 PermissionEngine 的 canonical action 不一致，无法准确展示实际权限门禁。

## 方案比较

### 方案 A：保留确认前 generic `xcodebuild test -enumerate-tests`

优点：可以直接读取 enumeration JSON。

缺点：仍可能执行 workspace 脚本；把“未安装到设备”误当成“无宿主机副作用”；不满足 R5/R7。

### 方案 B：确认前只解析元数据，确认后执行路径专属 readiness（决策）

优点：确认前保持只读；如实区分结构候选与真实运行结果；权限语义可审计；分析失败可以 fail-closed。

缺点：确认前不能宣称配置已经真实可运行；需要解析 shared scheme/Test action/test plan 元数据，并显式表达 limitation。

### 方案 C：仅依据 `hasXCUITest` 或 scheme 名称选择

优点：实现最简单。

缺点：无法证明 scheme 的 Test action 引用了 XCUITest target，继续违反 R4。

## 决策

### 1. 确认前只产出结构候选

Project Analyzer 在 TestPlan 确认前只能执行 metadata-only 操作，不得运行任何 Xcode build/test/archive action，不得执行 scheme pre-action 或项目 Run Script。

```text
xcuitestExecutionCandidate =
  scheme
  + scheme Test action 引用的 graph-proven XCUITest target
  + 可选 test plan 关联
  + 声明的 targetKind 相容性
  + evidence 与 limitations
```

候选只证明“结构上可选择”，不命名为 runnable，也不宣称 build/signing/install/test 已验证。`hasXCUITest`、scheme 名称或 target 名称仍不能单独触发 XCUITest 路径。

### 2. 探测结果必须显式区分三种状态

```text
executionAssets.status = available | none | indeterminate
```

- `available`：存在一个或多个证据充分的结构候选。
- `none`：metadata-only 分析权威完成，确认不存在候选。
- `indeterminate`：读取、解析或工具调用失败，无法得出有无候选的结论。

`prefer=auto` 只有在 `status=none` 时才能选择 DeviceBackend；`indeterminate` 必须 blocked。用户显式选择 `device_backend` 时仍尊重显式选择。

### 3. 确认、权限与真实执行

- 规划阶段按候选唯一性选择路径，并在确认前展示 evidence、limitations、scheme/test plan 与选择原因。
- 歧义选择只更新 TestPlan 草稿，必须回到 `awaiting_plan_confirmation`，不能直接执行。
- TestPlan 确认后，任何可能执行 workspace build phase 或 scheme action 的命令必须先通过 canonical `execute_project_build` 权限。
- 具体 iPhone/Simulator destination、provisioning、App/test runner 安装或替换还必须通过 `replace_device_app` 权限；真机需要时才允许 `-allowProvisioningUpdates`。
- 确认后的 metadata revalidation 只检查候选身份是否仍存在；具体 build/signing/install/test 的失败保留为已确认 XCUITest 路径结果，不切换到 DeviceBackend。

### 4. 权限 action 统一

TestPlan `safety.highRiskActions` 与 PermissionEngine 必须共享 canonical action 名称。v3 writer 不得继续输出 `clear_data`、`reinstall`、`write_project`、`generate_draft` 等旧别名。兼容 reader 按 ADR-022 显式迁移旧值；未知值返回 typed issue，不猜测。

T6.5 新增的 canonical action 为：

```text
execute_project_build
replace_device_app
```

前者覆盖宿主机执行工程 build/test action 及其脚本副作用；后者覆盖目标设备或 Simulator 上的 App/test runner 安装、覆盖或替换。一个操作同时涉及两类风险时必须分别取得权限，不得用其中一个代替另一个。

### 5. TestPlan v3 与结果语义

TestPlan v3 的路由字段保留，但选择原因改为结构证据语义：

```text
execution.selectionReason:
  explicit_preference
  | evidence_backed_xcuitest
  | confirmed_no_xcuitest_candidate
  | user_selected_after_ambiguity
```

`resolvedPath=xcuitest` 时 JSON Schema 与运行时校验都必须要求 `execution.xcuitest.scheme`。任何 readiness rejection 都必须返回带已选 path 和空 fallback history 的结构化 blocked/failed 结果，不能逸出 dispatcher 契约。

## 后果

### 正面

- 确认前项目分析不执行任意 workspace 脚本。
- “没有候选”和“无法判断”不再混淆，`auto` 路由可以 fail-closed。
- 计划展示的安全策略与实际 PermissionEngine action 一致。
- XCUITest 失败仍保留在用户确认的路径，不产生静默语义降级。

### 负面

- metadata-only parser 无法证明具体 destination 上一定构建成功，必须在 TUI 中显式展示该 limitation。
- 未共享或无法静态解析的 scheme/test plan 可能得到 `indeterminate`，需要用户修复工程元数据或显式选择其他路径。
- v3 合并前需要同步调整 contracts、migration、schema、analyzer、planning state 与测试。

## 验证要求

- fixture 必须包含可观测的 Run Script sentinel，并证明确认前分析不会执行它。
- 覆盖 `available/none/indeterminate` 路由矩阵。
- 覆盖歧义选择回到计划确认、blocked 可恢复、run identity 不变。
- 覆盖 runtime 与发布 JSON Schema 的条件一致性。
- G5/G5-SIM 的既有真实执行证据继续证明确认后执行链路，但不得反向用来宣称旧的确认前 enumeration 安全。

## 关联文档

- ADR-022：Persisted Schema Migrations
- ADR-027：Planning Cycle State and Snapshot Boundary
- ADR-029：双执行路径解析与语义降级边界
- `docs/01-spec/全量用户故事与验收标准规格书.md`
- `docs/02-architecture/架构设计文档.md`
- `docs/02-architecture/数据流全链路技术说明文档.md`
