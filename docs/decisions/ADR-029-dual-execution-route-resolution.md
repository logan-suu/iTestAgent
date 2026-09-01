# ADR-029：双执行路径解析与语义降级边界

**状态**：Accepted
**日期**：2026-09-01
**决策者**：Logan Su + Codex（T6.5 规格评审确认）
**关联任务**：T6.5
**关联条目**：DEF-032

## 背景

US-7.1 与既有架构把生产执行描述为“有 XCUITest target 时优先 `xcodebuild test`，否则进入 DeviceBackend 探索”。该描述不足以安全驱动生产调度：XCUITest target 的存在不证明存在包含该 target 的可执行 scheme/Test action，也不证明可选 test plan、destination 与当前 `targetKind` 相容。

现有 TestPlan 还包含 `execution.fallback=device_backend`。若把它解释为“XCUITest 构建、测试或解析失败后自动进入探索”，会改变已确认计划的执行语义，并可能掩盖真实测试失败，违反 R4/R5。

此外，既有数据流在解析执行路径之前统一执行 backend/WDA readiness，使 XCUITest 路径可能被不相关的 Appium/WDA 状态阻断。

## 方案比较

### 方案 A：继续以 `hasXCUITest` 布尔值调度

优点：实现简单，兼容现有 Project Profile。

缺点：无法证明测试可由 scheme/Test action 在目标 destination 上执行；多 scheme/test plan 时会猜测；不满足 Target-explicit 与 R4。

### 方案 B：运行时尝试 XCUITest，失败后自动探索

优点：表面成功率高。

缺点：把测试失败、基础设施失败和“无测试资产”混为一谈；执行中改变用户确认的语义；违反 R5。

### 方案 C：确认前解析可执行配置，执行后禁止语义 fallback（决策）

项目分析先产出带证据和 limitation 的可执行 XCUITest 配置候选；规划阶段按用户偏好和候选唯一性解析路径，将所选 scheme/test plan 写入待确认 TestPlan。用户确认后，S4 只重新验证该选择并生成 RunPlan，不得静默换路。

## 决策

### 1. 可执行 XCUITest 配置

生产调度中的“XCUITest 可用”必须由一个可执行配置证明：

```text
runnableXcuitestConfiguration =
  scheme
  + scheme Test action 中至少一个 XCUITest target
  + 可选的关联/默认 test plan
  + 与已选 targetKind 的 generic platform 相容；具体 destination readiness 留到确认后
  + 可追踪 evidence 与 limitations
```

- `ProjectProfile.testAssets.hasXCUITest` 仅表示工程图中发现了 UI test target，可用于兼容展示，不能单独触发生产路径。
- `ProjectProfile.testAssets.hasScheme` 是现有粗粒度兼容字段；当前 producer 的 scheme 名称启发式不能证明 Test action 或 target 关联，T6.5 不得继续把它用于调度。
- scheme 名称包含 `test` 不是可执行性证据。
- 第一版把详细配置放入当次 `ProjectAnalysisResult.analysis`/执行资产快照，避免未经迁移直接改变持久化 `project-profile.v1`。
- 被选中的 `scheme`、可选 `testPlan` 和目标过滤必须写入 TestPlan，使确认后的执行不依赖重新猜测。
- 规划期资产探测禁止传入具体 Simulator/iPhone destination。必须使用对应 generic platform、关闭 code signing，并且不得安装 App 或 test runner；generic probe 仅允许“需要具体设备才能运行”这一预期 limitation，JSON 中其他 `errors` 必须 fail-closed。
- 具体 destination、签名、provisioning、安装与 launch 仅在 TestPlan 确认且 `replace_device_app` 权限通过后执行。真机首次签名允许使用 `-allowProvisioningUpdates`，但不得在分析阶段提前触发。

TestPlan canonical schema 升级为 `itestagent.test-plan.v3`，writer 必须补充：

```text
execution.resolvedPath: xcuitest | device_backend
execution.selectionReason:
  explicit_preference
  | runnable_xcuitest
  | no_runnable_xcuitest
  | user_selected_after_ambiguity
execution.xcuitest: { scheme, testPlan?, targets? }  # resolvedPath=xcuitest 时必需
```

旧 v1/v2 TestPlan 由 ADR-022 migration/compatibility reader 读取：只有现有字段能无歧义推出路径时才迁移为 v3；信息不足或歧义时返回 typed migration/validation issue，不得猜测。canonical writer 不再输出 v2，也不输出缺少 `resolvedPath`/`selectionReason` 的新计划。

### 2. 路由矩阵

| `execution.prefer` | 可执行配置 | 解析结果 |
|---|---|---|
| `device_backend` | 任意 | DeviceBackend；显式选择优先 |
| `xcuitest` | 已唯一解析且相容 | XCUITest |
| `xcuitest` | 缺失、歧义或不相容 | blocked；不得降级 |
| `auto` | 唯一配置或存在明确默认配置 | XCUITest |
| `auto` | 多个配置且无明确默认 | 在 TestPlan 确认前询问用户 |
| `auto` | 无可执行配置 | DeviceBackend |

`execution.fallback=device_backend` 仅表示 `prefer=auto` 在规划阶段确认“无可执行 XCUITest 配置”时选择 DeviceBackend。它不表示 XCUITest 已开始后的失败降级。显式 `prefer=xcuitest` 必须使用 fail-closed/abort 语义。

### 3. 确认与重新验证

- TUI 展示 TestPlan 时必须显示解析后的路径、选择原因、scheme/test plan（如适用）和 limitation。
- 多个候选无法唯一解析时，必须在确认前询问；不得选择“第一个 scheme”。
- 确认后的 TestPlan 是路径选择的单一事实源。
- S4 可以用无安装 generic probe 重新检查 scheme、test plan 与 targetKind，并检查具体 destination/tool 状态；若事实已变化，RunPlan 标记 blocked 并要求修改/重新确认计划，不得换路。

### 4. 路径专属 readiness

```text
共同前置：confirmed TestPlan + targetKind/destination + workspace/profile snapshot

XCUITest readiness:
  generic probe 的 scheme/Test action/test plan/targetKind
  + 确认后的具体 xcodebuild destination + build/signing/install permission
  不要求 Appium/WDA ready

DeviceBackend readiness:
  AUT source/build/install/launch + selected DeviceBackend healthcheck
  + Appium/WDA active readiness（当选择 Appium 时，遵循 ADR-028）
```

执行路径必须先解析，随后才运行该路径所需的 readiness。

### 5. 失败与结果语义

- `xcodebuild test` 一旦开始，构建失败、测试失败、超时、xcresult 缺失或解析失败都保留为 XCUITest 路径结果。
- DeviceBackend healthcheck 或探索失败保留为 DeviceBackend 路径结果。
- 跨路径重试必须由用户修改或创建 TestPlan 并重新确认；不得在同一已确认执行中静默发生。
- `result.json.execution` 必须记录 resolved path、selection reason、scheme/test plan（适用时）和显式 fallback history。

### 6. 任务与验证责任

- T6.5 实现可执行配置解析、确认后双路径生产调度、真实 backend contract 统一，并核查 DEF-032。
- T6.6 负责探索动作、逐 case checkpoint、RunStep/Flow，不把 T6.5 的路由选择与完整探索可靠性混为一项。
- 自动化测试必须覆盖完整路由矩阵、歧义、显式选择、事实变化、路径专属 readiness 和禁止执行后 fallback。
- XCUITest 路径宣称支持 physical + simulator，必须分别完成真实 iPhone G5 与 CoreSimulator G5-SIM；仅 mock/fixture 或组件测试不得宣称闭环通过。
- G5 必须验证资产探测本身不选择具体设备、不安装 test runner；确认后的执行才可产生设备侧变更。

## 后果

### 正面

- 调度依据从粗粒度 target 存在性提升为可执行配置证据。
- 已确认计划不会因运行失败而静默改变语义。
- XCUITest 不再被无关的 WDA/Appium 前置阻断。
- 多 scheme/test plan 项目得到可审计、可确认的确定性选择。

### 负面

- Project Analyzer 需要补充 scheme/Test action/test plan 的执行资产解析。
- TestPlan 编译、校验与生产 composition 需要同步收紧。
- T6.5 必须增加真实双目标 XCUITest 验证，无法再以框架单测代替 G5/G5-SIM。

## 关联文档

- ADR-010：Agent Harness Runtime Boundary
- ADR-011：iOS Simulator First-Class Support
- ADR-022：Persisted Schema Migrations
- ADR-027：Planning Cycle State and Snapshot Boundary
- ADR-028：Physical Preflight and WDA Readiness
- `docs/01-spec/全量用户故事与验收标准规格书.md`
- `docs/02-architecture/架构设计文档.md`
- `docs/02-architecture/数据流全链路技术说明文档.md`
