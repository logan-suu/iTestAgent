# Task 6.3 G6 验证报告：Intent 到已确认 TestPlan

## 范围

- 任务：6.3「一句话到已确认 TestPlan：workspace 分析、Intent、计划修改/确认/取消」
- 用户故事：US-3.1~3.3、US-4.2、US-5.1~5.2
- 验证日期：2026-08-31
- 结论：任务实现与目标回归通过；任务状态保持 `in_progress`，等待提交 PR 与人类合并确认。

## 规格原文与覆盖证据

> AC3 只有用户确认的链路进入 TestPlan 和 Flow
>
> AC4 系统不把未确认的推断链路当作既定事实

`PlanningSession.confirmCandidates()` 是生成草案的唯一入口，并校验候选名称、证据和置信度均来自本次 Project Profile；`TestPlanCompiler` 仅编译 `confirmed: true` 的候选，不再以 `suggestedSmoke` 补入未确认链路。没有已确认候选时编译显式失败。

> AC1 支持多轮对话与追问

TUI 会话保留有界对话历史，并通过 `awaiting_clarification`、`awaiting_candidate_confirmation`、`awaiting_plan_confirmation` 等状态完成澄清、候选确认和计划确认。

> AC4 TestPlan 引用 Project Profile

生产 workspace 分析完成后将 Project Profile 写入本地数据根；TestPlan 保留其 `projectHash` 引用。计划修改不会替换 `runId` 或 Profile 引用。

> AC1 提供 开始 / 修改 / 取消
>
> AC2 用户可用自然语言修改计划（如“只跑登录，不要下单”）
>
> AC3 未确认不执行

候选复核与计划复核已接入 TUI 键盘事件。自然语言修改会更新草案；确认后才暴露 `getConfirmedPlan()`；取消后不保留可执行计划。执行工具在最终确认前显式拒绝执行，6.5 接入设备执行前也不会越过该门禁。

## 自动化证据

- `bun run typecheck`：通过。
- `bun run lint`：通过，791 个文件无违规。
- `bun test tests/integration/phase6/phase6-intent-plan-confirmation.test.ts`：2 通过、0 失败、13 个断言。
- 6.3 定向回归：100 通过、0 失败、323 个断言、7 个文件。
- 宿主环境无过滤 `bun test`：3383 通过、13 跳过、0 失败、8638 个断言、317 个文件。
- 宿主环境 `bun run test:ci`：3267 通过、13 跳过、0 失败、8304 个断言、307 个文件。
- `git diff --check`：通过。

## 门禁结论

- G1 规格一致：通过。S3 与避坑手册已同步确认链路和计划门禁。
- G2 契约校验：通过。继续使用既有 Project Profile/TestPlan schema；未新增不兼容字段。
- G3 静态检查：通过。
- G4 测试：目标测试与相关累计回归通过。
- G5/G5-SIM：不适用。本任务未新增或修改真机、Simulator、构建、安装或设备执行能力。
- G6 证据留档：本报告。
- G7 安全合规：通过。Profile 默认写入 iTestAgent 本地数据根；未写项目目录、未处理凭证、未执行高风险设备操作。

## 显式未决项

Phase 6 现有延期项 DEF-025、DEF-029、DEF-030、DEF-031、DEF-032 均未由 6.3 解决，继续保持 `open`。
