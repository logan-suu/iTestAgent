# Task 6.11 G6 验证报告：生产组合自动化闭环

## 范围与结论

- 任务：6.11「生产组合自动化闭环测试：TUI 指令到报告、解释和重跑的跨包验证」
- 验证日期：2026-09-04
- 结论：DeviceBackend 与 XCUITest 两条生产组合自动化闭环均已通过；T6.1 的 RED 结构契约已转为常规绿色回归。
- 状态：PR #80 已由人类合并到 `dev-1.0`（merge commit `dbc8750`）；任务 6.11 已进入 `done`，任务 6.12 已级联为 `ready`。
- 边界：项目分析和设备发现使用生产 composition root；CI 只在 analyzer xcodebuild、devicectl/simctl、device/Appium、xcodebuild/xcresult 与 LLM 等外部传输边界使用确定性 doubles，不新增 G5/G5-SIM 结论；真实 iPhone 双路径出口由 T6.12 验收。

## 规格原文与覆盖证据

> AC5 screenshot/video/UI tree 等可能含敏感界面的原始设备证据只可在当前 run 的 artifacts 中以 raw-local-only 保存；报告仅引用其本地路径与元数据，不嵌入原始内容

DeviceBackend 路径从 TUI 的生产项目分析与 devicectl/simctl 设备发现开始，经候选确认、TestPlan 确认、真实 `ToolDispatcher`、`PermissionEngine`、生产执行器、探索循环、backend adapter、RunStore/RunWriter 与报告合成器提交 canonical bundle。测试采集一份包含敏感哨兵文本的截图 transport fixture，验证提交后的 artifact 为 `raw-local-only`，且 `result.json` 不含原始内容。

> AC4 explain 只消费带 result.json commit marker 且通过交叉校验的 canonical run bundle；必须读取 plan/steps/result/artifact-index 与采集结果，不能用空 steps 或不相关历史替代本次证据

Commander `explain` action 与集成测试现在共用 `runExplainCommand()` 生产处理器。两条路径均从已提交 bundle 读取 plan、steps、result、artifact index 与 collection outcomes；DeviceBackend 用真实探索 step，XCUITest 用 `xcodebuild_test` 与 `xcresult_parse` 事实步骤。

> AC2 重跑只接受完整 canonical TestPlan v3 bundle；T6.9 的可执行重跑范围是具有权威 `Target/Class/Method` 标识的 XCUITest case。DeviceBackend 自动探索 case 默认不可复现，必须在设备访问和 child run 创建前以 `rerun_case_not_reproducible` 阻断

DeviceBackend parent 的 failed-only 请求由共用 `runRerunCommand()` 在 discovery、backend 创建和 child run 创建前阻断。XCUITest parent 通过真实 production dispatcher 调用注入的进程 transport，xcresult parser 从权威 node URL 恢复 `MyAppUITests/LoginTests/testFailure`，child 仅传入这一条 `-only-testing`，配置 test target 保持不变。

> AC4 重跑创建新 runId 的 child TestPlan，plan.rerun 记录直接 parentRunId、mode 与唯一 selectedCaseIds；result.parentRunId 必须与 plan 一致并可由 bundle 恢复到 SQLite

测试验证 child plan/result 的 `parentRunId` 一致、selectedCaseIds 唯一、parent failed + child passed 产生 `flaky`，并由同一 RunStore 提交与重新读取。

> AC5 用户取消必须同时取消 pending ask 与运行中 tool，并把同一 AbortSignal 贯穿 AgentRuntime、ToolDispatcher、所选执行路径、backend/parser 与其拥有的子进程

取消场景验证同一个 `AbortSignal` 到达 DeviceBackend 执行和 owner cleanup；最终仍提交可校验的 `cancelled` bundle。既有 T6.10 专项测试继续覆盖 pending ask、子进程和 terminal teardown 的更完整矩阵。

## 实现收口

- `createProductionDualExecutionDispatcher()` 新增窄 `ProductionExecutionTransports`：只允许替换 XCUITest process runner 与 metadata revalidation transport，不能替换 dispatcher、permission、persistence、report、explain 或 rerun。
- `executeProductionTestPlanToDefaultStore()` 成为 TUI 默认执行的共享生产入口；TUI 不再复制 dispatcher/persistence 流程，并统一执行 backend cleanup。
- TUI 在锁定 plan、bundle 与 device 后以精确 `${bundleId}@${udid}` 资源逐次确认高风险 action；托管 Route B 会额外确认 `prepare_wda`，一次性授权凭据同时绑定 action 与 resource。
- T6.11 通过生产 XcodeProj analyzer 与 Appium device discovery provider 建立项目和设备事实，只在其 xcodebuild 与 devicectl/simctl transport 注入确定性 fixture。
- CLI `explain` 与 `rerun` 的 Commander actions 委托到可直接测试的共用生产处理器。
- `phase6-physical-closed-loop.test.ts` 覆盖 DeviceBackend、XCUITest 与 abort/cleanup 三个行为场景。
- `phase6-physical-closed-loop-contract.test.ts` 移除 `ITESTAGENT_PHASE6_RED` 跳过条件，并沿真实跨模块调用关系检查生产结构。

## 自动化证据

- T6.11 行为与结构定向测试：17 通过、0 失败、51 个断言。
- `bun run typecheck`：通过。
- `bun run lint`：通过，841 个文件无违规。
- `bun run build`：通过（当前根脚本执行 typecheck）。
- 无过滤 `bun test`：3607 通过、29 跳过、0 失败、9218 个断言、343 个文件。
- `git diff --check`：通过。

## 门禁结论

- G1 规格一致：通过。先复审并修正 T6.11 责任边界；实现符合 ADR-029~036。
- G2 契约校验：通过。沿用 canonical TestPlan v3、RunResult v3、RunSteps v1 与 ArtifactIndex v2，完整 bundle 由现有跨文件校验提交。
- G3 静态检查：通过。
- G4 测试：通过。新增两条生产路径和取消场景，并完成全库回归。
- G5/G5-SIM：本任务不新增声明。外部 transport 由确定性 doubles 替代；T6.12 负责当前真实 iPhone 双路径出口。
- G6 证据留档：本报告。
- G7 安全合规：通过。高风险构建/替换/WDA 准备动作按精确 action/resource 逐次授权；raw-local-only 原文未进入报告或解释输入；无 secret 落盘。

## 显式未覆盖项

doctor、本地 Server 生命周期、真实 Simulator 构建安装、性能/baseline、CLI 安装与配置管理、草稿生成继续由各自专项测试和历史验证报告负责，不由单个 T6.11 文件重复声明覆盖。
