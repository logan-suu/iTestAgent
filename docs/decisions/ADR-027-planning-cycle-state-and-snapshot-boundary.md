# ADR-027: Planning Cycle 状态与不可变快照边界

**状态**: 已接受
**日期**: 2026-08-31
**决策人**: 项目负责人（确认先评审并修正规格后再评审实现）
**关联**: US-3.3、US-4.2、US-5.2、R4、ADR-002、ADR-010

## 背景

现有规格已经确定候选链路需要用户确认、计划修改后需要重新确认、未确认或已取消的 TestPlan 不得进入执行。但以下边界没有被明确描述：

1. 同一 Agent Session 中的普通后续消息是否会自动开始新规划；
2. `confirmed` 与 `cancelled` 是否可被任意后续调用隐式改写；
3. TUI、tool 或其他调用方拿到 Planning Snapshot 后，是否允许通过修改返回对象改变会话内部状态。

这些空白会导致不同实现都声称符合文字规格，却破坏确认的可审计性与取消语义。

## 方案对比

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 每条消息自动开始新规划，返回可变引用 | 实现简单 | 多轮追问会破坏已确认状态；外部修改可绕过确认 | 不采用 |
| 依赖 TUI mode 约束，engine 不校验转换 | UI 代码较少 | 非 UI 调用、重复事件或未来入口可进入非法状态 | 不采用 |
| 显式 Planning Cycle + 状态守卫 + 不可变快照 | 语义可审计；入口一致；确认边界稳定 | 需要复制状态并补充转换测试 | 采用 |

## 决策

1. 同一测试目标的多轮消息属于同一个 Planning Cycle；普通追问不得隐式开始新周期或使已确认计划失效。
2. 新测试目标必须由显式用户动作开始。开始新周期时，旧 Intent、候选、草稿及相关对话状态必须原子清理或替换，不得混用。
3. `confirmed` 与 `cancelled` 是当前 Planning Cycle 的终态。`confirmed` 只能进入当前 run 的后续阶段或结束；`cancelled` 只能结束。继续规划必须显式创建新周期。
4. 每个状态转换由 engine 校验合法来源状态，不能只依赖 TUI mode 或 prompt 约束。
5. Planning Cycle 在输入处复制外部对象，并向所有调用方返回不可变快照。修改 snapshot、candidate evidence、Intent 或 TestPlan 返回值不得改变内部状态或确认基线。
6. 计划修改产生新的待确认草稿，必须再次确认；只有确认转换产生的 TestPlan 可以成为 S4-S9 的输入。

## 后果

### 正面

- 多轮对话与计划确认不再相互覆盖。
- 取消和确认具有明确、可测试的终态语义。
- TUI、AI SDK tool、测试代码及未来 server API 共享同一确认边界。
- 外部对象修改不能绕过 US-3.3 与 US-5.2 的人在环路门禁。

### 负面

- engine 需要显式 Planning Cycle 生命周期 API 和状态转换守卫。
- 嵌套数据需要深复制、深冻结或等价的不可变值策略。
- 需要增加普通追问、显式新规划、取消后调用和返回值 mutation 的回归测试。

## 验证要求

1. 确认计划后发送普通追问，当前 confirmed TestPlan 保持可用。
2. 只有显式新规划动作可以替换当前 Planning Cycle，且旧草稿不出现在新周期。
3. 取消后调用候选确认、修改或计划确认均被拒绝。
4. 修改任意返回 snapshot 的嵌套字段，不改变后续 snapshot 或 confirmed TestPlan。
5. 修改计划后必须再次确认，执行入口仍只接受 confirmed TestPlan。

## 参考

- `docs/01-spec/全量用户故事与验收标准规格书.md` — US-3.3、US-4.2、US-5.2
- `docs/02-architecture/架构设计文档.md` — §4.1 Agent Session 流程
- `docs/02-architecture/数据流全链路技术说明文档.md` — S1、S3
- `docs/03-implementation/开发避坑与关键注意点手册.md` — §5 Project Profile
- `docs/decisions/ADR-002-candidate-links-not-auto.md`
- `docs/decisions/ADR-010-agent-harness-runtime-boundary.md`
