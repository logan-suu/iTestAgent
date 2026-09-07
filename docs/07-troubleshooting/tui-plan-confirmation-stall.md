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

再次真机复测发现，TestPlan 确认消息可见后，权限请求、权限超时和执行结果虽然已进入 TUI state，却可能不再出现在 OpenTUI 消息区。根因是聊天页在挂载时把 `messages` 属性固化为旧数组，后续状态更新只刷新了 header，消息列表没有响应新数组；用户因此只能看到“Starting execution”，无法判断是在等待权限还是执行已经失败。修复后，消息区通过显式 memo 跟踪 state 中的数组替换并增量更新；确认动作还会同步发布 `Preparing confirmed TestPlan execution…` activity，权限阶段切换为 `Awaiting permission`，执行队列以 operation owner 清理，防止旧异步清理覆盖新执行。`PermissionEngine` 必须先注册 pending ask 再发布请求事件，确保事件消费者即时答复不会丢失。真实 PTY 回归必须同时观察 activity、权限正文，并证明设备 UDID 不进入聊天 transcript。

## 后续修复：窄输入视口与静默执行阶段

真机复测在连续权限确认时又暴露了两个问题。第一，聊天输入框位于横向 flex 容器内但没有占据剩余宽度；OpenTUI 因而为它分配了极窄的可视区域。`allow` 的完整值仍进入输入事件，但屏幕只显示末尾的 `low`，用户容易重复输入并得到 `aallow`。修复方式是让聊天输入控件显式 `flexGrow`，并以长中文消息提交后立即输入 `allow` 的 character-frame 与真实 PTY 场景同时验证完整显示和完整提交。

第二，权限全部放行后，生产执行虽然继续运行，但 `tool.progress` 被 TUI 映射层丢弃，DeviceBackend 闭环也没有发布“启动应用、读取界面、等待模型动作、执行动作、评估断言、保存结果”等阶段，因此长耗时操作只显示静态的 `Executing confirmed TestPlan…`。本次现场运行实际在约 101 秒后提交了 `infra_failed` bundle，并非永久死锁；失败原因为模型对无需元素定位的观察动作省略 `target`，而解析器对所有动作统一强制 `target`。修复后，生产执行只发布不含设备标识和原始 UI tree 的真实阶段文本，不使用伪造百分比；`screenshot`、`swipe`、`wait` 可生成确定性的审计目标，`tap`、`input` 仍必须显式提供元素目标并 fail closed。失败终态必须清除 activity，显示原因，并在 bundle 已提交时显示对应 run。
