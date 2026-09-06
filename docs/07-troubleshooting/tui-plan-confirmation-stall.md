# TUI 计划确认后停滞与陈旧设备状态

## 症状

- 真机从未连接变为 USB 连接后，用户按 `r` 刷新并选择设备；TestPlan 确认后却返回聊天页，没有开始后续执行。
- 聊天中可能同时出现 `generate_draft_test` 权限请求和基于旧发现快照的 `device_not_ready`。
- header 与设备选择页对同一时刻的 readiness 结论不一致。

## 根因

确定性规划状态机在产生候选、设备或计划审阅页后，仍继续启动同一轮 AI SDK tool loop。模型因此可以在用户尚未完成检查点时并发刷新设备、编译计划或请求执行，造成会话 inventory、面板 inventory 和权限请求来自不同快照。设备 Enter 只读取已有数组，没有重新验证所选 UDID；计划 Enter 只把模式切回聊天，没有调度已确认计划。

此外，`compileTestPlan` 被错误映射为 `generate_draft_test`。后者是生成测试代码草稿的独立高风险动作，不适用于只在内存中形成 TestPlan。

## 修复原则

1. 确定性人机检查点存在时暂停模型 tool loop。
2. `r` 与设备 Enter 共用串行发现队列；Enter 只接受刷新后仍为 ready 的同 targetKind、同 UDID 设备。
3. TestPlan Enter 直接调度已确认计划；安装、WDA、构建等高风险动作仍由 `PermissionEngine` 逐项确认。
4. `compileTestPlan` 不请求 `generate_draft_test` 权限。
5. 真实 PTY 回归断言一次 Enter 只触发一次当前面板事件，并且不会穿透到切换后的面板。

## 验证场景

从 physical 设备 `discovered` 开始，模拟 USB 接入后按 `r`，选择刷新后为 `ready` 的同一设备，确认 TestPlan，处理真实执行权限，并验证执行 seam 只调用一次。整个规划阶段不得产生模型 turn 或 `generate_draft_test` 权限请求。

## 后续修复：权威状态与异步结果顺序

真机复测继续暴露了两个交互层问题：设备页遗留的 `device_not_ready` 会在后续聊天页继续显示，而 OpenTUI 会在入口与会话确认动作前先本地执行 `plan_confirm`，造成页面先切回聊天、但权威确认结果和权限提示尚未提交的假象。此外，`r` 刷新与设备 Enter 的异步结果缺少版本约束，较早请求可能在较新操作后回写。

修复后，候选、设备与 TestPlan 的确认、取消及提交动作只由入口/会话层提交权威状态；设备刷新和选择使用单调操作版本，迟到结果被丢弃。真实 PTY 回归必须连续验证“设备 Enter → TestPlan Enter → 权威确认/权限提示”，同时保留第一次 Enter 不得穿透到下一面板的断言。
