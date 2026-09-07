# ADR-037：确认目标、执行断言与前台活性反馈

**状态**：Accepted

**日期**：2026-09-07

**决策者**：Logan Su + Codex（T6.12 真机验收确认）

**关联任务**：T6.12

## 背景

T6.12 真机验收发现，自然语言中的具体操作和“确认某文本可见”在 S3 编译时被压缩为通用 `exploration`，已确认 TestPlan 只保留 feature 名称和 `explore_only`。生产动作模型因此只看到 `CASE: Validation`、UI tree 与历史步骤，不知道要点击 `Tap Me` 或以 `Taps: 1` 为成功条件；当模型重复 wait/screenshot 等动作时，执行循环只能依赖十二步上限。与此同时，OpenTUI 的 Activity 文本是静态的，长耗时操作无法向用户证明事件循环仍在工作。

这违反 TestPlan 作为 S3-S9 单一事实源、用户明确断言优先以及 US-4.2 AC2 流式展示执行进度的约束。

## 决策

1. `TestPlan.execution` 增加向后兼容的可选字段：
   - `goal`：经敏感信息脱敏、在 Plan Review 中展示并确认的用户执行目标；
   - `assertions`：从用户明确成功条件编译出的结构化 `UserAssertion[]`。
2. 新 writer 必须写入非空 `goal`；DeviceBackend 执行旧计划时若缺少该字段，必须要求重新规划并确认，不得以 feature 名称猜测目标。
3. 中文“确认/验证/检查‘…’可见”和对应英文表达编译为 `source=user` 的 `element_visible` 条件，并把断言策略提升为 `user_goal_then_profile_then_agent_confirmed`。无法可靠结构化的文本保留在 `goal`，不得伪造断言。
4. DeviceBackend 动作模型必须同时接收已确认 goal、当前 case 的成功条件、模型安全 UI tree 与历史步骤；原始设备证据仍遵循 ADR-032，不进入模型上下文。
5. 动态探索检测“UI 投影不变且同一建议动作重复”。连续两次无进展后在下一次动作前停止，产生 `no_progress`；达到步数上限产生 `step_limit`。无可判定断言时结果为 `inconclusive`，并在 TUI 与报告中显式说明，禁止静默循环。
6. OpenTUI 在存在 activity 时显示持续更新的单列宽 spinner；activity 完成、失败、取消或 renderer 销毁时必须清理 timer。spinner 只表达前台事件循环活性，不得被描述为底层设备动作成功。

`itestagent.test-plan.v3` 不升版本：新增字段为可选，已有 v3 文件仍可读取；只有 DeviceBackend 的生产执行入口对缺少 goal 的旧计划失败关闭。该策略保留读取兼容性，同时阻止旧计划继续盲目探索。

## 后果

- Plan Review 能在执行前暴露真正的目标和成功条件，执行模型与断言评估使用同一确认事实。
- 重复无进展不再消耗完整步数预算，用户得到明确终止原因。
- OpenTUI 在后台等待模型、设备或证据处理时有持续可见反馈。
- 当前结构化解析只覆盖明确的可见性表达；其他自然语言断言仍需后续 parser 扩展或人工确认，不能静默推断。

## 验证要求

1. 使用 T6.12 原始中文 prompt 验证 goal、两条 user assertion 与 tiered policy。
2. 验证动作模型 prompt 包含 goal 和 success criteria，且敏感文本已脱敏。
3. 固定 UI tree 与重复动作验证 `no_progress`、`inconclusive` 和用户可见终止消息。
4. OpenTUI 字符帧在 activity 存续期间至少捕获两个不同 spinner 帧，activity 文本与设备标识脱敏边界保持不变。
5. 通过 typecheck、lint、全量测试；真机最终结果仍需 G5 人工验收，不以 mock 代替。

## 关联文档

- ADR-032：本地原始证据与模型安全投影
- ADR-036：生产 TUI、权限与终止语义
- `docs/02-architecture/数据流全链路技术说明文档.md` §6
- `docs/03-implementation/开发避坑与关键注意点手册.md` §4
