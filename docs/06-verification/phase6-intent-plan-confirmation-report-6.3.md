# Task 6.3 G6 验证报告：Intent 到已确认 TestPlan

## 范围

- 任务：6.3「一句话到已确认 TestPlan：workspace 分析、Intent、计划修改/确认/取消」
- 用户故事：US-3.1~3.3、US-4.2、US-5.1~5.2
- 验证日期：2026-08-31
- 结论：初始目标回归通过，但规格复审补充的 Planning Cycle 状态与不可变快照门禁尚未满足；任务保持 `in_progress`，PR 暂不可合并。

## 规格原文与覆盖证据

> AC3 只有用户确认的链路进入 TestPlan 和 Flow
>
> AC4 系统不把未确认的推断链路当作既定事实

`PlanningSession.confirmCandidates()` 是生成草案的唯一入口，并校验候选名称、证据和置信度均来自本次 Project Profile；`TestPlanCompiler` 仅编译 `confirmed: true` 的候选，不再以 `suggestedSmoke` 补入未确认链路。没有已确认候选时编译显式失败。

> AC1 支持多轮对话与追问
>
> AC3 同一测试目标的多轮消息属于同一个 Agent Session / Test Run Session；普通追问不得隐式启动新规划或使已确认 TestPlan 失效
>
> AC4 新测试目标必须由用户显式发起；进入新规划周期时必须原子清除上一周期的 Intent、候选和草稿状态

TUI 会话保留有界对话历史，并通过 `awaiting_clarification`、`awaiting_candidate_confirmation`、`awaiting_plan_confirmation` 等状态完成澄清、候选确认和计划确认。但当前 `processMessage()` 会对非 clarification 的普通消息调用 `begin()`，导致已确认计划失效，也没有显式的新 Planning Cycle 动作。本项未通过。

> AC4 TestPlan 引用 Project Profile

生产 workspace 分析完成后将 Project Profile 写入本地数据根；TestPlan 保留其 `projectHash` 引用。计划修改不会替换 `runId` 或 Profile 引用。

> AC1 提供 开始 / 修改 / 取消
>
> AC2 用户可用自然语言修改计划（如“只跑登录，不要下单”）
>
> AC3 未确认不执行
>
> AC4 修改后的计划必须重新确认；取消是当前规划周期的终态，恢复规划必须由用户显式开始新周期
>
> AC5 待确认与已确认 TestPlan 对会话调用方均为不可变值；调用方修改返回对象不得改变会话内部状态或已确认执行基线

候选复核与计划复核已接入 TUI 键盘事件。自然语言修改会更新草案，执行工具在最终确认前显式拒绝执行。但当前 snapshot/confirm 返回可变内部引用，调用方可把未确认 feature 注入确认结果；`confirmCandidates()` 缺少来源状态守卫，取消后可原地恢复规划。本项未通过。

上述澄清由 ADR-027 记录，并已同步到规格、架构、数据流与避坑手册。

## 自动化证据

- `bun run typecheck`：通过。
- `bun run lint`：通过，791 个文件无违规。
- `bun test tests/integration/phase6/phase6-intent-plan-confirmation.test.ts`：2 通过、0 失败、13 个断言。
- 6.3 定向回归：100 通过、0 失败、323 个断言、7 个文件。
- 宿主环境无过滤 `bun test`：3383 通过、13 跳过、0 失败、8638 个断言、317 个文件。
- 宿主环境 `bun run test:ci`：3267 通过、13 跳过、0 失败、8304 个断言、307 个文件。
- `git diff --check`：通过。

## 门禁结论

- G1 规格一致：未通过。实现尚未满足 ADR-027 的 Planning Cycle 状态与不可变快照边界。
- G2 契约校验：通过。继续使用既有 Project Profile/TestPlan schema；未新增不兼容字段。
- G3 静态检查：通过。
- G4 测试：现有目标测试与相关累计回归通过，但缺少普通追问保持 confirmed、显式新规划、取消终态和返回值 mutation 回归，门禁未通过。
- G5/G5-SIM：不适用。本任务未新增或修改真机、Simulator、构建、安装或设备执行能力。
- G6 证据留档：本报告。
- G7 安全合规：通过。Profile 默认写入 iTestAgent 本地数据根；未写项目目录、未处理凭证、未执行高风险设备操作。

## 显式未决项

Phase 6 现有延期项 DEF-025、DEF-029、DEF-030、DEF-031、DEF-032 均未由 6.3 解决，继续保持 `open`。
